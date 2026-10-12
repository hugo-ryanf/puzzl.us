import express from 'express';
import { PIECE_COUNT_PRESETS } from '@puzzle/shared';

// 2567 é a porta padrão do Colyseus, que vai rodar neste mesmo processo na fase 2.
const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, piecePresets: PIECE_COUNT_PRESETS });
});

app.listen(PORT, () => {
  console.log(`[server] ouvindo em http://localhost:${PORT}`);
});
