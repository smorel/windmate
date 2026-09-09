const express = require('express');
const { syncIgetwindSpots } = require('../services/igetwindSync');

function createIgetwindRouter(db) {
  const router = express.Router();

  router.post('/sync', async (_req, res) => {
    try {
      const result = await syncIgetwindSpots(db);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createIgetwindRouter };
