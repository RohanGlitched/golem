// The trial workers' script for the yard studio. The robot comes from this script's own URL (?robot=<id>), which
// src/studio/yard.ts sets, so one built worker serves every yard robot.
import { standApp } from '@app/yard-stand';
import './fetch-shim';
import { serveStudioWorker } from 'golem-spec/ui/worker';

const id = new URL(self.location.href).searchParams.get('robot') ?? 'go1';
serveStudioWorker(standApp(id, new URL(`/yard/${id}/robot/`, self.location.href)));
