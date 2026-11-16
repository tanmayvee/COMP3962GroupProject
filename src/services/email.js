// email service
// local mode: prints the email in the terminal
// aws mode:   sends with SES
// every email in the app goes through send(), so switching to SES only changes this file

const local = {
  async send({ to, subject, body }) {
    console.log(`\n[email] to: ${to}\n  subject: ${subject}\n  ${body.replace(/\n/g, '\n  ')}\n`);
  },
};

const aws = {
  // still need to implement with @aws-sdk/client-sesv2 (SendEmailCommand from SES_FROM_EMAIL)
  // SES starts in sandbox mode, so every address we send to has to be verified first
  async send() { throw new Error('SES not wired up yet'); },
};

const driver = process.env.EMAIL_DRIVER === 'aws' ? aws : local;

// builds a normal looking email: greeting, the lines you pass in, sign off
// (null lines get skipped so optional bits like the budget are easy)
function letter(greeting, lines) {
  return [greeting, '', ...lines.filter((line) => line !== null), '', 'Happy gifting,', 'Secret Santa'].join('\n');
}

// feature B: tells each santa who they drew
async function sendDrawEmail(giver, receiverName, group) {
  await driver.send({
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

module.exports = { send: (msg) => driver.send(msg), letter, sendDrawEmail };
