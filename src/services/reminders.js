// reminder service
// local mode: prints when the reminder would go out
// aws mode:   creates one-time EventBridge Scheduler schedules that send the email through SES directly (no lambda)
//
// scheduleReminder(group, pairs) - pairs = [{ giverId, email, giverName, gifteeName }], one email per santa
// cancelReminders(groupId)       - removes a group's schedules (date changed or group deleted)

const { letter } = require('./email');

const DAYS_BEFORE = 3;
const SEND_HOUR = 9; // reminders go out at 9am on the day

// exchange dates come in as a Date from postgres or a "YYYY-MM-DD" string from a form.
// new Date('2026-12-20') reads that as UTC midnight, which is the day before here,
// so build it from the parts to get local midnight instead
function localDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// when the reminder should go out (9am, 3 days before), or null if there's no date / it's too late to bother
function remindAt(exchangeDate) {
  if (!exchangeDate) return null;
  const when = localDate(exchangeDate);
  when.setDate(when.getDate() - DAYS_BEFORE);
  when.setHours(SEND_HOUR);
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
  async scheduleReminder(group, pairs) {
    const when = remindAt(group.exchange_date);
    if (!when) {
      console.log(`[reminder] skipped for "${group.name}", exchange is too soon or has no date\n`);
      return;
    }
    console.log(`[reminder] "${group.name}" reminder scheduled for ${when.toDateString()} 9am -> ${pairs.map((p) => p.email).join(', ')}\n`);
  },
  async cancelReminders(groupId) {
    console.log(`[reminder] cancelled any reminders for group ${groupId}\n`);
  },
};

// the aws sdk only gets loaded when we actually use it
function makeAws() {
  const {
    SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand, ListSchedulesCommand,
  } = require('@aws-sdk/client-scheduler');
  const scheduler = new SchedulerClient({ region: process.env.AWS_REGION });

  // schedule names look like ss-g12-u3 (group 12, santa 3) so we can find a group's schedules later
  const prefix = (groupId) => `ss-g${groupId}-`;
  // EventBridge wants "2026-12-15T09:00:00" plus a timezone, not a js date
  const atExpression = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `at(${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00)`;
  };

  return {
    async scheduleReminder(group, pairs) {
      const when = remindAt(group.exchange_date);
      if (!when) return;

      for (const p of pairs) {
        // build the email now, counting down from the day it'll actually be sent ("in 3 days")
        const msg = reminderEmail(group, p.giverName, p.gifteeName, when);
        try {
          await scheduler.send(new CreateScheduleCommand({
            Name: `${prefix(group.id)}u${p.giverId}`,
            ScheduleExpression: atExpression(when),
            ScheduleExpressionTimezone: process.env.APP_TIMEZONE || 'America/Vancouver',
            FlexibleTimeWindow: { Mode: 'OFF' },
            ActionAfterCompletion: 'DELETE', // cleans itself up after sending
            Target: {
              // "universal target": EventBridge calls SES's SendEmail itself, no lambda in between
              Arn: 'arn:aws:scheduler:::aws-sdk:sesv2:sendEmail',
              // the role EventBridge uses to send through SES (made in the deploy steps)
              RoleArn: process.env.SCHEDULER_ROLE_ARN,
              Input: JSON.stringify({
                FromEmailAddress: process.env.SES_FROM_EMAIL,
                Destination: { ToAddresses: [p.email] },
                Content: { Simple: { Subject: { Data: msg.subject }, Body: { Text: { Data: letter(msg.greeting, msg.lines) } } } },
              }),
            },
          }));
        } catch (err) {
          // a reminder failing to schedule shouldn't undo the draw
          console.error(`couldn't schedule reminder for ${p.email}:`, err.message);
        }
      }
    },

    async cancelReminders(groupId) {
      try {
        let NextToken;
        do {
          const page = await scheduler.send(new ListSchedulesCommand({ NamePrefix: prefix(groupId), NextToken }));
          for (const sched of page.Schedules || []) {
            await scheduler.send(new DeleteScheduleCommand({ Name: sched.Name }));
          }
          NextToken = page.NextToken;
        } while (NextToken);
      } catch (err) {
        console.error(`couldn't cancel reminders for group ${groupId}:`, err.message);
      }
    },
  };
}

module.exports = { ...(process.env.REMINDER_DRIVER === 'aws' ? makeAws() : local), remindAt, localDate, reminderEmail };
