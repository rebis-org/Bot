import 'dotenv/config';
import process from 'node:process';

async function main(): Promise<void> {
  const baseUrl = process.env.MATRIX_HS_URL!;
  const accessToken = process.env.AS_TOKEN!;
  const userId = process.env.BOT_USER_ID!;
  const res = await fetch(
    `${baseUrl}/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ displayname: 'Rebis' })
    }
  );
  if (!res.ok) {
    throw new Error(`set displayname failed: ${res.status} ${await res.text()}`);
  }
  console.log('displayname set to Rebis');
}

main();
