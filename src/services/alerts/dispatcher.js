// Turns signal-engine detections into persisted events, in-app
// notifications, and (subject to per-rule cooldown + per-user daily cap)
// emails. Every detection is recorded and pushed to the dashboard
// regardless of cooldown -- cooldown_minutes only throttles *email*
// cadence, so the in-app signal feed always reflects what actually fired.
const alertRulesRepo = require('../../db/repositories/alertRules.repo');
const alertEventsRepo = require('../../db/repositories/alertEvents.repo');
const notificationsRepo = require('../../db/repositories/notifications.repo');
const usersRepo = require('../../db/repositories/users.repo');
const emailService = require('../email.service');
const realtime = require('../../realtime');
const env = require('../../config/env');
const { getSignal } = require('../signals/catalog');

async function dispatch(instrument, detections) {
  for (const { rule, result, barTs } of detections) {
    await dispatchOne(instrument, rule, result, barTs);
  }
}

async function dispatchOne(instrument, rule, result, barTs) {
  const event = await alertEventsRepo.create({
    ruleId: rule.id,
    instrumentId: instrument.id,
    signalKey: rule.signal_key,
    barTs,
    payload: { direction: result.direction, message: result.message, values: result.values },
  });
  if (!event) return; // already recorded for this (rule, bar) -- not a new detection

  const notification = await notificationsRepo.create(rule.user_id, event.id);
  const signalDef = getSignal(rule.signal_key);

  realtime.broadcastToUser(rule.user_id, 'signal', {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    signalKey: rule.signal_key,
    signalName: signalDef ? signalDef.name : rule.signal_key,
    direction: result.direction,
    message: result.message,
    triggeredAt: event.triggered_at,
    notificationId: notification.id,
  });
  realtime.broadcast(`signals:${instrument.id}`, 'signal', {
    symbol: instrument.symbol,
    signalKey: rule.signal_key,
    signalName: signalDef ? signalDef.name : rule.signal_key,
    direction: result.direction,
    message: result.message,
    triggeredAt: event.triggered_at,
  });

  if (!rule.email_enabled) return;

  const cooldownMs = (rule.cooldown_minutes || 60) * 60 * 1000;
  const sinceLastEmail = rule.last_triggered_at ? Date.now() - new Date(rule.last_triggered_at).getTime() : Infinity;
  if (sinceLastEmail < cooldownMs) return;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const emailedToday = await alertEventsRepo.countEmailedForUserSince(rule.user_id, since24h);
  if (emailedToday >= env.emailDailyCap) return;

  const user = await usersRepo.findById(rule.user_id);
  if (!user) return;

  try {
    await emailService.sendSignalAlertEmail(user, {
      symbol: instrument.symbol,
      signalName: signalDef ? signalDef.name : rule.signal_key,
      timeframe: rule.timeframe,
      triggeredAt: event.triggered_at,
      details: { direction: result.direction, message: result.message, ...result.values },
      ruleId: rule.id,
      instrumentId: instrument.id,
    });
    await alertEventsRepo.markEmailed(event.id);
    await alertRulesRepo.markTriggered(rule.id);
  } catch (err) {
    console.error(`[dispatcher] failed to send alert email for rule ${rule.id}:`, err);
  }
}

module.exports = { dispatch };
