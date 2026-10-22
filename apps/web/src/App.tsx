import { useEffect, useState } from 'react';
import type { HealthResponse } from '@popcorno/shared';

type ServerState = { kind: 'loading' } | { kind: 'up'; version: string } | { kind: 'down' };

export function App(): React.JSX.Element {
  const [server, setServer] = useState<ServerState>({ kind: 'loading' });

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json() as Promise<HealthResponse>)
      .then((health) => setServer({ kind: 'up', version: health.version }))
      .catch(() => setServer({ kind: 'down' }));
  }, []);

  return (
    <main className="shell">
      <h1>Popcorno</h1>
      <p className="muted">
        {server.kind === 'loading' && 'Checking the server…'}
        {server.kind === 'up' && `Server up — v${server.version}`}
        {server.kind === 'down' && 'Server unreachable'}
      </p>
    </main>
  );
}
