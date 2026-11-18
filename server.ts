import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.resolve(__dirname, 'agriswarm.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS mission_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    duration_sec REAL NOT NULL,
    field_harvested_pct REAL NOT NULL,
    layer1_pct REAL NOT NULL,
    layer2_pct REAL NOT NULL,
    layer3_pct REAL NOT NULL,
    avg_battery_pct REAL NOT NULL,
    collisions INTEGER NOT NULL,
    deadlocks INTEGER NOT NULL,
    tractors_active INTEGER NOT NULL,
    field_pace REAL NOT NULL,
    notes TEXT
  )
`);

interface MissionInsertBody {
  durationSec?: number;
  fieldHarvestedPct?: number;
  layer1Pct?: number;
  layer2Pct?: number;
  layer3Pct?: number;
  avgBatteryPct?: number;
  collisions?: number;
  deadlocks?: number;
  tractorsActive?: number;
  fieldPace?: number;
  notes?: string;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'agriswarm-3d-os' });
  });

  app.get('/api/missions', (_req, res) => {
    try {
      const rows = db
        .prepare(
          `SELECT id, created_at, duration_sec, field_harvested_pct,
                  layer1_pct, layer2_pct, layer3_pct, avg_battery_pct,
                  collisions, deadlocks, tractors_active, field_pace, notes
           FROM mission_runs
           ORDER BY id DESC
           LIMIT 25`
        )
        .all();
      res.json({ missions: rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to query mission_runs';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/missions', (req, res) => {
    try {
      const body = (req.body || {}) as MissionInsertBody;
      const createdAt = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO mission_runs (
          created_at, duration_sec, field_harvested_pct,
          layer1_pct, layer2_pct, layer3_pct,
          avg_battery_pct, collisions, deadlocks,
          tractors_active, field_pace, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = stmt.run(
        createdAt,
        Number(body.durationSec ?? 0),
        Number(body.fieldHarvestedPct ?? 0),
        Number(body.layer1Pct ?? 0),
        Number(body.layer2Pct ?? 0),
        Number(body.layer3Pct ?? 0),
        Number(body.avgBatteryPct ?? 100),
        Number(body.collisions ?? 0),
        Number(body.deadlocks ?? 0),
        Number(body.tractorsActive ?? 1),
        Number(body.fieldPace ?? 1),
        String(body.notes ?? 'Swarm mission snapshot')
      );

      const inserted = db
        .prepare('SELECT * FROM mission_runs WHERE id = ?')
        .get(info.lastInsertRowid);

      res.status(201).json({ mission: inserted });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save mission run';
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/missions', (_req, res) => {
    try {
      const info = db.prepare('DELETE FROM mission_runs').run();
      res.json({ deleted: info.changes });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear mission_runs';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AgriSwarm 3D OS server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AgriSwarm server:', err);
  process.exit(1);
});
