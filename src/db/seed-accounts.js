// the 4 test accounts (all password123)
// on AWS, SES only emails verified addresses at first, so set SEED_EMAILS in .env to real inboxes
// (comma separated, in the order alpha,bravo,charlie,delta) BEFORE running npm run db:reset.
// that way the live demo's emails actually land somewhere we can show
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

function seedAccounts() {
  const custom = (process.env.SEED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return NAMES.map((name, i) => ({ name, email: custom[i] || `${name.toLowerCase()}@example.com` }));
}

module.exports = { seedAccounts };
