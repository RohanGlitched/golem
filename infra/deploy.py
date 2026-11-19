"""Deploy the GOLEM static site to AWS (S3 + CloudFront, region ap-southeast-2).

Usage:  python infra/deploy.py [--dist site/dist] [--stack golem-site] [--skip-stack]

Credentials come from the standard AWS environment variables or profile; nothing is stored here.
Creates or updates the CloudFormation stack in infra/stack.yaml, uploads every file under --dist
with the right Content-Type and Cache-Control, deletes files that are no longer in the build,
and invalidates the HTML paths.
"""
import argparse
import hashlib
import mimetypes
import os
import sys
import time

import boto3
from botocore.exceptions import ClientError

REGION = 'ap-southeast-2'
TYPES = {
    '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.stl': 'application/octet-stream', '.STL': 'application/octet-stream', '.bin': 'application/octet-stream',
    '.xml': 'application/xml', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
    '.jsonl': 'application/x-ndjson', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon',
}


def content_type(path):
    ext = os.path.splitext(path)[1]
    return TYPES.get(ext) or TYPES.get(ext.lower()) or mimetypes.guess_type(path)[0] or 'application/octet-stream'


def cache_control(key):
    if key.endswith('.html') or key.endswith('.json') and key.startswith('data/'):
        return 'public, max-age=60, must-revalidate'
    if '/assets/' in key or key.startswith('assets/'):
        return 'public, max-age=31536000, immutable'  # Vite hashes these names
    return 'public, max-age=3600'


def deploy_stack(cfn, stack, template):
    try:
        cfn.describe_stacks(StackName=stack)
        exists = True
    except ClientError:
        exists = False
    try:
        if exists:
            cfn.update_stack(StackName=stack, TemplateBody=template)
            waiter = cfn.get_waiter('stack_update_complete')
        else:
            cfn.create_stack(StackName=stack, TemplateBody=template, OnFailure='DELETE')
            waiter = cfn.get_waiter('stack_create_complete')
        print(f'{"updating" if exists else "creating"} stack {stack} ...', flush=True)
        waiter.wait(StackName=stack, WaiterConfig={'Delay': 15, 'MaxAttempts': 120})
    except ClientError as e:
        if 'No updates are to be performed' not in str(e):
            raise
        print('stack unchanged')
    outs = cfn.describe_stacks(StackName=stack)['Stacks'][0]['Outputs']
    return {o['OutputKey']: o['OutputValue'] for o in outs}


def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def sync(s3, bucket, dist):
    existing = {}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket):
        for o in page.get('Contents', []):
            existing[o['Key']] = o['ETag'].strip('"')
    local = {}
    for root, _, files in os.walk(dist):
        for f in files:
            p = os.path.join(root, f)
            local[os.path.relpath(p, dist).replace(os.sep, '/')] = p
    up = 0
    for key, path in sorted(local.items()):
        if existing.get(key) == md5(path):
            continue
        s3.upload_file(path, bucket, key, ExtraArgs={'ContentType': content_type(key), 'CacheControl': cache_control(key)})
        up += 1
    gone = [k for k in existing if k not in local]
    for i in range(0, len(gone), 1000):
        s3.delete_objects(Bucket=bucket, Delete={'Objects': [{'Key': k} for k in gone[i:i + 1000]]})
    print(f'uploaded {up}, deleted {len(gone)}, total {len(local)} files')
    return up + len(gone)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dist', default='site/dist')
    ap.add_argument('--stack', default='golem-site')
    ap.add_argument('--skip-stack', action='store_true')
    a = ap.parse_args()
    if not os.path.isfile(os.path.join(a.dist, 'index.html')):
        sys.exit(f'{a.dist}/index.html not found: build the site first (npm run build -w site)')
    here = os.path.dirname(os.path.abspath(__file__))
    cfn = boto3.client('cloudformation', region_name=REGION)
    if a.skip_stack:
        outs = {o['OutputKey']: o['OutputValue'] for o in cfn.describe_stacks(StackName=a.stack)['Stacks'][0]['Outputs']}
    else:
        outs = deploy_stack(cfn, a.stack, open(os.path.join(here, 'stack.yaml'), encoding='utf-8').read())
    s3 = boto3.client('s3', region_name=REGION)
    changed = sync(s3, outs['Bucket'], a.dist)
    if changed:
        cf = boto3.client('cloudfront')
        cf.create_invalidation(DistributionId=outs['DistributionId'], InvalidationBatch={
            'Paths': {'Quantity': 1, 'Items': ['/*']}, 'CallerReference': str(time.time())})
        print('invalidated /*')
    print(outs['Url'])


if __name__ == '__main__':
    main()
