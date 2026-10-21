import http from 'http';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';

// Import the app
const appModule = await import('./dist/index.js');
const app = appModule.default?.default || appModule.default || appModule;

const server = http.createServer(app);

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const baseUrl = `http://localhost:${port}/api`;
console.log(`\n🧪 Testing Shed Concurrency on ${baseUrl}\n`);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

try {
  // Step 1: Admin & Incharge Authentication
  console.log('--- Step 1: Authentication ---');
  const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
  });
  const adminLoginData = await adminLoginRes.json();
  assert(adminLoginRes.status === 200 && adminLoginData.token, 'Admin logged in successfully');
  const adminToken = adminLoginData.token;

  const loginRes1 = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'incharge', password: 'Incharge@123' })
  });
  const loginData1 = await loginRes1.json();
  assert(loginRes1.status === 200 && loginData1.token, 'Incharge 1 (incharge) logged in successfully');
  const token1 = loginData1.token;
  const user1 = loginData1.user;

  const loginRes2 = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'incharge2', password: 'Incharge@123' })
  });
  const loginData2 = await loginRes2.json();
  assert(loginRes2.status === 200 && loginData2.token, 'Incharge 2 (incharge2) logged in successfully');
  const token2 = loginData2.token;
  const user2 = loginData2.user;

  // Step 2: Create a Test Farm with 2 Sheds
  console.log('\n--- Step 2: Create Multi-Shed Farm ---');
  const createFarmRes = await fetch(`${baseUrl}/farms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      name: `Concurrency Farm ${Date.now()}`,
      flockDate: new Date().toISOString().split('T')[0],
      ageWeek: 'W18',
      season: 'Summer',
      shedCount: 2,
      sheds: [
        { name: 'Shed 1', type: 'Female' },
        { name: 'Shed 2', type: 'Female' }
      ]
    })
  });
  const farmData = await createFarmRes.json();
  assert(createFarmRes.status === 201 && farmData.id, `Created farm "${farmData.name}" (ID: ${farmData.id})`);
  const testFarm = farmData;

  const sheds = testFarm.sheds || [];
  assert(sheds.length >= 2, `Farm has ${sheds.length} sheds configured`);
  const shed1 = sheds[0];
  const shed2 = sheds[1];
  console.log(`  Shed 1: "${shed1.name}" (ID: ${shed1.id})`);
  console.log(`  Shed 2: "${shed2.name}" (ID: ${shed2.id})`);

  // Step 3: Multi-Incharge Farm Assignment (4 to 6 Incharges assigned simultaneously)
  console.log('\n--- Step 3: Multi-Incharge Farm Assignment (6 Incharges) ---');
  const assignRes = await fetch(`${baseUrl}/farms/${testFarm.id}/assign-operators`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      operatorUserIds: [user1.id, user2.id, 'u-incharge-3', 'u-incharge-4', 'u-incharge-5', 'u-incharge-6']
    })
  });
  const assignData = await assignRes.json();
  assert(assignRes.status === 200, 'Assigned 6 Incharges to the same farm simultaneously');

  // Step 4: Incharge 1 acquires lock on Shed 1
  console.log('\n--- Step 4: Shed Lock Acquisition & Active Collision ---');
  const enterRes1 = await fetch(`${baseUrl}/sheds/${shed1.id}/enter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`
    },
    body: JSON.stringify({ userId: user1.id, userName: user1.name })
  });
  const enterData1 = await enterRes1.json();
  assert(enterRes1.status === 200 && enterData1.locked === true, 'Incharge 1 acquired lock on Shed 1');
  assert(enterData1.lockedByUserId === user1.id, `Lock assigned to User ID: ${user1.id} (${enterData1.lockedByUserName})`);

  // Step 5: Incharge 2 attempts to enter Shed 1 -> Must return 409 Conflict
  const collisionRes = await fetch(`${baseUrl}/sheds/${shed1.id}/enter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token2}`
    },
    body: JSON.stringify({ userId: user2.id, userName: user2.name })
  });
  const collisionData = await collisionRes.json();
  assert(collisionRes.status === 409, `Incharge 2 was BLOCKED from Shed 1 with HTTP 409 Conflict`);
  assert(collisionData.locked === true, 'Collision response returns locked: true');
  assert(collisionData.lockedByUserName === user1.name, `Collision response identifies occupant: "${collisionData.lockedByUserName}"`);
  assert(collisionData.message.includes(shed1.name), `Collision message specifies shed name: "${collisionData.message}"`);

  // Step 6: Incharge 2 enters Shed 2 simultaneously -> Must succeed with 200 OK
  console.log('\n--- Step 6: Simultaneous Multi-Shed Weighing ---');
  const enterRes2 = await fetch(`${baseUrl}/sheds/${shed2.id}/enter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token2}`
    },
    body: JSON.stringify({ userId: user2.id, userName: user2.name })
  });
  const enterData2 = await enterRes2.json();
  assert(enterRes2.status === 200 && enterData2.locked === true, 'Incharge 2 entered Shed 2 concurrently without conflict');

  // Step 7: Verify Live Presence Badges Endpoint
  console.log('\n--- Step 7: Live Presence Badges Query (GET /sheds/locks) ---');
  const locksRes = await fetch(`${baseUrl}/sheds/locks?farmId=${testFarm.id}`, {
    headers: { Authorization: `Bearer ${token1}` }
  });
  const locksData = await locksRes.json();
  assert(locksData.locks && locksData.locks[shed1.id], 'Lock map contains Shed 1');
  assert(locksData.locks[shed1.id]?.lockedByUserId === user1.id, `Shed 1 live badge: 🔒 Weighing: ${locksData.locks[shed1.id]?.lockedByUserName}`);
  assert(locksData.locks[shed2.id]?.lockedByUserId === user2.id, `Shed 2 live badge: 🔒 Weighing: ${locksData.locks[shed2.id]?.lockedByUserName}`);

  // Step 8: Heartbeat keep-alive
  console.log('\n--- Step 8: Keep-Alive Heartbeat ---');
  const hbRes = await fetch(`${baseUrl}/sheds/${shed1.id}/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`
    },
    body: JSON.stringify({ userId: user1.id, userName: user1.name })
  });
  const hbData = await hbRes.json();
  assert(hbRes.status === 200 && hbData.success === true, 'Heartbeat keep-alive updated timestamp successfully');

  // Step 9: Lock Release & Operator Attribution Persistence
  console.log('\n--- Step 9: Lock Release & Operator Attribution ---');
  const leaveRes = await fetch(`${baseUrl}/sheds/${shed1.id}/leave`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`
    },
    body: JSON.stringify({
      recordedByUserId: user1.id,
      recordedByUserName: user1.name,
      hasRecordedWeights: true
    })
  });
  const leaveData = await leaveRes.json();
  assert(leaveRes.status === 200 && leaveData.locked === false, 'Incharge 1 released Shed 1 lock');
  assert(leaveData.recordedByUserName === user1.name, `Recorded attribution preserved: "Weighed by: ${leaveData.recordedByUserName}"`);

  // Step 10: Incharge 2 can now enter Shed 1 that was previously locked
  const enterAgainRes = await fetch(`${baseUrl}/sheds/${shed1.id}/enter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token2}`
    },
    body: JSON.stringify({ userId: user2.id, userName: user2.name })
  });
  assert(enterAgainRes.status === 200, 'Incharge 2 can now enter Shed 1 after release');

  // Step 11: Supervisor Force-Unlock Override
  console.log('\n--- Step 11: Supervisor Override: Force Unlock ---');
  const forceRes = await fetch(`${baseUrl}/sheds/${shed2.id}/force-unlock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ role: 'Supervisor' })
  });
  const forceData = await forceRes.json();
  assert(forceRes.status === 200 && forceData.success === true, 'Supervisor successfully force-unlocked Shed 2');

  const verifyUnlockedRes = await fetch(`${baseUrl}/sheds/locks?farmId=${testFarm.id}`, {
    headers: { Authorization: `Bearer ${token1}` }
  });
  const verifyUnlockedData = await verifyUnlockedRes.json();
  assert(verifyUnlockedData.locks[shed2.id]?.locked === false, 'Shed 2 lock state verified as unlocked');

  console.log(`\n========================================`);
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

} catch (err) {
  console.error('Fatal test error:', err);
  failed++;
} finally {
  server.close(() => {
    process.exit(failed > 0 ? 1 : 0);
  });
}
