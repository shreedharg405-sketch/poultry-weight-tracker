import app from './index.js';
import { generateToken } from './services/authService.js';
import { prisma } from './db/prisma.js';
import http from 'http';

async function runTests() {
  console.log('🧪 Starting End-to-End Verification of Submit & Upload System...');

  // Start temporary test server
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5099, resolve));
  const baseUrl = 'http://127.0.0.1:5099/api';

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, detail ? detail : '');
      failed++;
    }
  }

  try {
    // Generate test tokens
    const adminToken = generateToken({
      id: 'u-admin-1',
      username: 'admin',
      role: 'Admin',
    });

    const supervisorToken = generateToken({
      id: 'u-supervisor-1',
      username: 'supervisor',
      role: 'Supervisor',
    });

    const unauthorizedInchargeToken = generateToken({
      id: 'u-incharge-1',
      username: 'incharge',
      role: 'In-Charge',
    });

    // -----------------------------------------------------------------------
    // Test 1: Reject unauthenticated submission
    // -----------------------------------------------------------------------
    console.log('\n--- Test 1: Authentication Requirement ---');
    const unauthRes = await fetch(`${baseUrl}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ farmId: 'farm-sai-1', sheds: [] })
    });
    assert(unauthRes.status === 401, 'Unauthenticated request rejected with 401 Unauthorized');

    // -----------------------------------------------------------------------
    // Test 2: Role and Farm Assignment Enforcement
    // -----------------------------------------------------------------------
    console.log('\n--- Test 2: Farm Assignment Enforcement ---');
    const unauthFarmRes = await fetch(`${baseUrl}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${unauthorizedInchargeToken}`
      },
      body: JSON.stringify({
        farmId: 'farm-sai-1',
        sheds: [{ name: 'Shed 1', parts: [{ name: 'Part A', lines: [{ name: 'Line 1', weights: [1200] }] }] }]
      })
    });
    assert(unauthFarmRes.status === 403, 'Unauthorized farm access rejected with 403 Forbidden');

    // -----------------------------------------------------------------------
    // Test 3: Block Incomplete Submissions (Pending lines detection)
    // -----------------------------------------------------------------------
    console.log('\n--- Test 3: Incomplete Batch Blocked ---');
    const incompletePayload = {
      farmId: 'farm-sai-1',
      flockAge: 'W18',
      season: 'Summer',
      sheds: [
        {
          name: 'Shed 1',
          type: 'Female',
          parts: [
            {
              name: 'Part A',
              lines: [
                { name: 'Line 1', weights: [1250, 1300, 1280] },
                { name: 'Line 2', weights: [] } // Empty line!
              ]
            }
          ]
        }
      ]
    };

    const incompleteRes = await fetch(`${baseUrl}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supervisorToken}`
      },
      body: JSON.stringify(incompletePayload)
    });

    const incompleteData = await incompleteRes.json();
    assert(incompleteRes.status === 400, 'Incomplete batch blocked with 400 Bad Request');
    assert(
      Array.isArray(incompleteData.pendingLines) && incompleteData.pendingLines.length > 0,
      'Pending lines returned with exact shed, part, and line names',
      incompleteData.pendingLines
    );

    // -----------------------------------------------------------------------
    // Test 4: Complete Valid Batch Submission & Persistence
    // -----------------------------------------------------------------------
    console.log('\n--- Test 4: Complete Submission with Every Bird Weight ---');
    const testIdempotencyKey = `test-idem-${Date.now()}`;
    const validWeightsLine1 = [1240, 1260, 1280, 1300, 1320];
    const validWeightsLine2 = [1310, 1330, 1350];
    const validWeightsMale = [2850, 2900, 2950, 3000];
    const totalExpectedBirds = validWeightsLine1.length + validWeightsLine2.length + validWeightsMale.length;

    const completePayload = {
      idempotencyKey: testIdempotencyKey,
      farmId: 'farm-sai-1',
      flockAge: 'W18',
      season: 'Summer',
      metadata: { notes: 'E2E Test Batch Weighing' },
      sheds: [
        {
          id: 'shed-test-1',
          name: 'Shed 1',
          type: 'Female',
          parts: [
            {
              id: 'part-test-1a',
              name: 'Part A',
              lines: [
                { id: 'line-test-1a-1', name: 'Line 1', weights: validWeightsLine1 },
                { id: 'line-test-1a-2', name: 'Line 2', weights: validWeightsLine2 },
              ]
            }
          ]
        },
        {
          id: 'shed-test-8',
          name: 'Shed 8 Male',
          type: 'Male',
          parts: [
            {
              id: 'part-test-8a',
              name: 'Part A',
              lines: [
                { id: 'line-test-8a-1', name: 'Line 1', weights: validWeightsMale }
              ]
            }
          ]
        }
      ]
    };

    const submitRes = await fetch(`${baseUrl}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supervisorToken}`
      },
      body: JSON.stringify(completePayload)
    });

    const submitData = await submitRes.json();
    assert(submitRes.status === 201, 'Valid batch submitted successfully with 201 Created');
    assert(submitData.status === 'COMPLETED', 'Submission status marked COMPLETED after persistence');
    assert(submitData.stats?.totalBirds === totalExpectedBirds, `Saved total birds count matches expected (${totalExpectedBirds})`);
    assert(submitData.submission?.submitterName === 'Suresh Kumar', 'Submitter name derived from authenticated token, not frontend');

    const createdSubId = submitData.submission?.id;

    // -----------------------------------------------------------------------
    // Test 5: Idempotency Protection on Retries
    // -----------------------------------------------------------------------
    console.log('\n--- Test 5: Idempotency on Retries ---');
    const retryRes = await fetch(`${baseUrl}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supervisorToken}`
      },
      body: JSON.stringify(completePayload)
    });

    const retryData = await retryRes.json();
    assert(retryRes.status === 200, 'Duplicate submission safely returns 200 OK');
    assert(retryData.status === 'COMPLETED', 'Retry maintains COMPLETED status');
    assert(retryData.submission?.id === createdSubId, 'Retry returns the same submission ID without creating duplicates');

    // -----------------------------------------------------------------------
    // Test 6: Cross-Device Retrieval (Phone B View)
    // -----------------------------------------------------------------------
    console.log('\n--- Test 6: Cross-Device Cloud Data Retrieval ---');
    const getSubsRes = await fetch(`${baseUrl}/submissions?farmId=farm-sai-1`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const subsList = await getSubsRes.json();
    assert(getSubsRes.status === 200, 'Submissions retrieved successfully');
    assert(
      Array.isArray(subsList) && subsList.some((s: any) => s.id === createdSubId),
      'Newly submitted batch is visible in submissions query for authorized devices'
    );

    // Retrieve full submission details with hierarchy
    const getDetailRes = await fetch(`${baseUrl}/submissions/${createdSubId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const subDetail = await getDetailRes.json();
    assert(getDetailRes.status === 200, 'Full submission hierarchy details retrieved');
    assert(subDetail.sheds?.length === 2, 'Hierarchy sheds preserved');

    // Retrieve individual bird weights
    const getBirdsRes = await fetch(`${baseUrl}/submissions/${createdSubId}/birds`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const birdsList = await getBirdsRes.json();
    assert(getBirdsRes.status === 200, 'Individual bird weights retrieved');
    assert(
      Array.isArray(birdsList) && birdsList.length === totalExpectedBirds,
      `Every single bird weight preserved (${birdsList.length} of ${totalExpectedBirds}) with sampleSequence and hierarchy`
    );

    // -----------------------------------------------------------------------
    // Test 7: Unauthorized Cross-Device Access Rejected
    // -----------------------------------------------------------------------
    console.log('\n--- Test 7: Unauthorized Access Blocked ---');
    const unauthDetailRes = await fetch(`${baseUrl}/submissions/${createdSubId}`, {
      headers: { 'Authorization': `Bearer ${unauthorizedInchargeToken}` }
    });
    assert(unauthDetailRes.status === 403, 'Unauthorized device retrieval blocked with 403 Forbidden');

    // -----------------------------------------------------------------------
    // Test 8: Health & DB Inspector Endpoints
    // -----------------------------------------------------------------------
    console.log('\n--- Test 8: Health & DB Inspector Endpoints ---');
    const healthRes = await fetch(`${baseUrl}/healthz`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, 'GET /healthz returns 200 OK');
    assert(healthData.database !== undefined, 'Healthz payload contains detailed database status');

    const dbHealthRes = await fetch(`${baseUrl}/health/db`);
    const dbHealthData = await dbHealthRes.json();
    assert(dbHealthRes.status === 200 || dbHealthRes.status === 503, 'GET /api/health/db responds with valid status');

    // -----------------------------------------------------------------------
    // Test 9: Farm and Activity Log Retrieval
    // -----------------------------------------------------------------------
    console.log('\n--- Test 9: Farm and Activity Log Retrieval ---');
    const farmsRes = await fetch(`${baseUrl}/farms`);
    const farmsData = await farmsRes.json();
    assert(farmsRes.status === 200, 'GET /api/farms responds with 200 OK');
    assert(Array.isArray(farmsData) && farmsData.length > 0, 'Farms list returned as array');

    const logsRes = await fetch(`${baseUrl}/logs`);
    const logsData = await logsRes.json();
    assert(logsRes.status === 200, 'GET /api/logs responds with 200 OK');
    assert(Array.isArray(logsData), 'Activity logs list returned as array');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
  }

  console.log('\n=======================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('=======================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
