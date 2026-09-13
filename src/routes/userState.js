const express = require('express');
const { getFullPreferences } = require('../db');
const { exportUserState, restoreUserState } = require('../services/userStateSync');

/** @param {import('better-sqlite3').Database} db @param {string} serverInstanceId */
function createUserStateRouter(db, serverInstanceId) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    try {
      res.json({
        serverInstanceId,
        bundle: exportUserState(db),
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.put('/', (req, res) => {
    try {
      const bundle = req.body?.bundle;
      if (!bundle) {
        return res.status(400).json({ error: 'bundle is required' });
      }
      restoreUserState(db, bundle);
      res.json({
        serverInstanceId,
        bundle: exportUserState(db),
        preferences: getFullPreferences(db),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createUserStateRouter };
