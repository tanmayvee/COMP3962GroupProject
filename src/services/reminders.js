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

// "today" / "tomorrow" / "in 5 days", counted from whenever the email actually goes out
function countdown(exchangeDate, now = new Date()) {
  const days = Math.round((localDate(exchangeDate) - localDate(now)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// the reminder email itself, shared by the scheduled one and the "send reminder now" button
// so what we demo is exactly what would go out on its own
function reminderEmail(group, giverName, gifteeName, now = new Date()) {
  const when = group.exchange_date ? countdown(group.exchange_date, now) : null;
  const date = group.exchange_date
    ? localDate(group.exchange_date).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
    : null;
  return {
    subject: when ? `Reminder: "${group.name}" gift exchange is ${when}` : `Reminder: "${group.name}" gift exchange is coming up`,
    greeting: `Hi ${giverName},`,
    lines: [
      when
        ? `Just a heads up, the "${group.name}" gift exchange is ${when} (${date}).`
        : `Just a heads up, the "${group.name}" gift exchange is coming up.`,
      `Don't forget your gift for ${gifteeName}!${group.budget ? ` The budget is $${Number(group.budget)}.` : ''}`,
      '',
      'Not sure what to get? Check their wishlist, or send them an anonymous hint to find out.',
    ],
  };
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

module.exports = { ...(process.env.REMINDER_DRIVER === 'aws' ? aws : local), remindAt, localDate, reminderEmail };
