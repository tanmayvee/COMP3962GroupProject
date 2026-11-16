// Local version of the reminder service
// Will be integrated with AWS EventBridge Scheduler later

async function scheduleReminder(groupId, exchangeDate) {
  if (!exchangeDate) {
    console.log(`[EventBridge MOCK] No exchange date set for group ${groupId}, skipping reminder.\n`);
    return;
  }
  console.log(`[EventBridge MOCK] Scheduled reminder email for group ${groupId} before ${exchangeDate}\n`);
}

module.exports = { scheduleReminder };
