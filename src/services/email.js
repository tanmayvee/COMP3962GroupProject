// email service
// local mode: prints the email in the terminal
// aws mode:   sends with SES
// every email in the app goes through send(), so switching to SES only changes this file

const local = {
  async send({ to, subject, body }) {
    console.log(`\n[email] to: ${to}\n  subject: ${subject}\n  ${body.replace(/\n/g, '\n  ')}\n`);
  },
};

// the aws sdk only gets loaded when we actually use it
function makeAws() {
  const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
  // no access keys here: on EC2 the sdk picks up the instance's IAM role by itself
  const ses = new SESv2Client({ region: process.env.AWS_REGION });

  return {
    async send({ to, subject, body }) {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: process.env.SES_FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
      }));
    },
  };
}

const driver = process.env.EMAIL_DRIVER === 'aws' ? makeAws() : local;

// sends an email and returns true/false instead of crashing.
// an email failing (like SES sandbox rejecting an address that isn't verified)
// should never break the thing that triggered it, the draw or hint is already saved
async function send(msg) {
  try {
    await driver.send(msg);
    return true;
  } catch (err) {
    console.error(`email to ${msg.to} failed:`, err.message);
    return false;
  }
}

// builds a normal looking email: greeting, the lines you pass in, sign off
// (null lines get skipped so optional bits like the budget are easy)
function letter(greeting, lines) {
  return [greeting, '', ...lines.filter((line) => line !== null), '', 'Happy gifting,', 'Secret Santa'].join('\n');
}

// feature B: tells each santa who they drew
async function sendDrawEmail(giver, receiverName, group) {
  return send({
    to: giver.email,
    subject: `Your Secret Santa pick for "${group.name}"`,
    body: letter(`Hi ${giver.name},`, [
      `Names have been drawn for "${group.name}" and you're buying for ${receiverName}!`,
      group.budget ? `The budget is $${Number(group.budget)}.` : null,
      '',
      'Keep it secret! Check the app to see their wishlist and send them anonymous hints.',
    ]),
  });
}

module.exports = { send, letter, sendDrawEmail };
