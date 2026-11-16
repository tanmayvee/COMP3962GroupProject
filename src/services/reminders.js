// reminder service
// local mode: prints when the reminder would go out
// aws mode:   creates a one-time EventBridge Scheduler schedule that sends the email through SES directly (no lambda)

const DAYS_BEFORE = 3;

// exchange dates come in as a Date from postgres or a "YYYY-MM-DD" string from a form.
// new Date('2026-12-20') reads that as UTC midnight, which is the day before here,
// so build it from the parts to get local midnight instead
function localDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// when the reminder should go out, or null if there's no date / it's too late to bother
function remindAt(exchangeDate) {
  if (!exchangeDate) return null;
  const when = localDate(exchangeDate);
  when.setDate(when.getDate() - DAYS_BEFORE);
  return when > new Date() ? when : null;
}

const local = {
  async scheduleReminder(group, emails) {
    const when = remindAt(group.exchange_date);
    if (!when) {
      console.log(`[reminder] skipped for "${group.name}", exchange is too soon or has no date\n`);
      return;
    }
    console.log(`[reminder] "${group.name}" reminder scheduled for ${when.toDateString()} -> ${emails.join(', ')}\n`);
  },
};

const aws = {
  // still need to implement with @aws-sdk/client-scheduler (CreateScheduleCommand)
  // at(...) expression from remindAt(), target = the SES SendEmail universal target
  async scheduleReminder() { throw new Error('EventBridge Scheduler not wired up yet'); },
};

module.exports = { ...(process.env.REMINDER_DRIVER === 'aws' ? aws : local), remindAt, localDate };
