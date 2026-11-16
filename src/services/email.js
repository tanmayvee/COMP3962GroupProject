// Local version of the email service
// Will be integrated with AWS SES later

async function sendDrawEmail(giver, receiverName, groupName) {
  console.log(`[SES MOCK] Email sent to ${giver.email}`);
  console.log(`[SES MOCK] Subject: Secret Santa Draw: ${groupName}`);
  console.log(`[SES MOCK] Body: Hi ${giver.name}, you have drawn ${receiverName}! Check the app to see their wishlist and send anonymous hints.`);
}

module.exports = { sendDrawEmail };
