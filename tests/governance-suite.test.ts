import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { resolveProductOrCartDeliveryCharge } from '../src/utils/locationCategoryHelpers.ts';
import { defaultDeliveryCities } from '../src/utils/defaultData.ts';
import { recalculateCustomerBalances } from '../src/utils/storage.ts';
import { hasRecordContentChanges, validateAndNormalizeDateOnly } from '../src/server/dateUtils.ts';
import type { Customer, SystemHealthReport, Transaction } from '../src/types/index.ts';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not allocate ephemeral port')));
      }
    });
  });
}

async function waitForServerHealth(baseUrl: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const data = (await res.json()) as { status?: string; ok?: boolean; connected?: boolean };
        if ((data.status === 'ok' || data.ok) && data.connected) return;
        lastError = new Error(`Unexpected /api/health payload: ${JSON.stringify(data)}`);
      } else {
        lastError = new Error(`HTTP ${res.status} from /api/health`);
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Test server failed to become healthy within ${timeoutMs}ms: ${String(lastError)}`);
}

describe('Business Rules & Calculation Protection (Unit)', () => {
  it('preserves delivery fee rules for Muzaffarabad City Center, Free Offer, and Custom Product rates', () => {
    const mzdDefault = resolveProductOrCartDeliveryCharge(
      defaultDeliveryCities,
      { id: 'p1', name: 'Std Item', deliveryFeeType: 'default' },
      'Muzaffarabad',
      'City Center',
      50
    );
    assert.equal(mzdDefault.charge, 50);
    assert.equal(mzdDefault.isFree, false);

    const freeOffer = resolveProductOrCartDeliveryCharge(
      defaultDeliveryCities,
      { id: 'p2', name: 'Free Item', deliveryFeeType: 'free' },
      'Karachi',
      'Clifton',
      50
    );
    assert.equal(freeOffer.charge, 0);
    assert.equal(freeOffer.isFree, true);

    const customRate = resolveProductOrCartDeliveryCharge(
      defaultDeliveryCities,
      { id: 'p3', name: 'Heavy Item', deliveryFeeType: 'custom', customDeliveryCharge: 320 },
      'Lahore',
      'Model Town',
      50
    );
    assert.equal(customRate.charge, 320);
    assert.equal(customRate.source, 'product_custom');
  });

  it('accurately reconciles customer balances, total purchases, and order counts from transactions', () => {
    const customers: Customer[] = [
      {
        id: 'cust_u1',
        name: 'Tariq Mahmood',
        customerType: 'individual',
        phone: '03005551111',
        address: 'Muzaffarabad',
        creditLimit: 5000,
        paymentTermsDays: 7,
        balance: 0,
        totalPurchases: 0,
        status: 'active',
        createdAt: '2026-01-01',
      },
    ];
    const txs: Transaction[] = [
      {
        id: 'tx_1',
        customerId: 'cust_u1',
        type: 'credit',
        amount: 2500,
        paidAmount: 500,
        dueBalance: 2000,
        notes: 'Credit invoice #1',
        date: '2026-01-02T10:00:00.000Z',
        paymentMode: 'cash',
        createdAt: '2026-01-02T10:00:00.000Z',
      },
      {
        id: 'tx_2',
        customerId: 'cust_u1',
        type: 'debit',
        amount: 750,
        notes: 'Partial payment',
        date: '2026-01-03T10:00:00.000Z',
        paymentMode: 'cash',
        createdAt: '2026-01-03T10:00:00.000Z',
      },
    ];
    const updated = recalculateCustomerBalances(customers, txs);
    assert.equal(updated[0].balance, 1250);
    assert.equal(updated[0].totalPurchases, 2500);
    assert.equal(updated[0].ordersCount, 1);
  });

  it('validates calendar dates strictly and detects real record changes without false positives', () => {
    assert.equal(validateAndNormalizeDateOnly('2026-11-28'), '2026-11-28');
    assert.throws(() => validateAndNormalizeDateOnly('2025-02-30'), /Invalid calendar date/);
    assert.equal(
      hasRecordContentChanges(
        { id: 'a', name: 'Item', stockQty: 5, updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a', name: 'Item', stockQty: 5, updatedAt: '2026-02-01T00:00:00.000Z' }
      ),
      false
    );
    assert.equal(
      hasRecordContentChanges(
        { id: 'a', name: 'Item', stockQty: 5 },
        { id: 'a', name: 'Item', stockQty: 4 }
      ),
      true
    );
  });
});

describe('Governance, Guest-First Checkout, Idempotency, Security & System Health (Integration)', () => {
  let tmpDir = '';
  let serverProc: ChildProcess | null = null;
  let baseUrl = '';
  let adminToken = '';
  let customerToken = '';
  let customerUserId = '';
  let testProductId = 'prod_gov_test_001';
  let placedOrderNumber = '';
  let guestClaimToken = '';

  const ADMIN_PIN = 'TestMaster@9988';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madinamarket-gov-'));
    const dbPath = path.join(tmpDir, 'data', 'test-governance.db');
    const backupDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');

    let serverOutput = '';
    serverProc = spawn(
      tsxBin,
      ['server.ts', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DB_DRIVER: 'sqlite',
          PORT: String(port),
          HOST: '127.0.0.1',
          SQLITE_DB_PATH: dbPath,
          BACKUP_DIR: backupDir,
          ADMIN_MASTER_PIN: ADMIN_PIN,
          SESSION_SECRET: 'isolated-governance-test-secret-0123456789',
          DISABLE_HMR: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    serverProc.stdout?.on('data', (chunk: Buffer) => {
      serverOutput += chunk.toString();
    });
    serverProc.stderr?.on('data', (chunk: Buffer) => {
      serverOutput += chunk.toString();
    });

    try {
      await waitForServerHealth(baseUrl, 20000);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nServer output:\n${serverOutput}`);
    }
  });

  after(async () => {
    if (serverProc && serverProc.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            serverProc?.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 3000);
        serverProc!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        serverProc!.kill('SIGTERM');
      });
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('blocks unauthenticated/guest access to System Health and internal server collections', async () => {
    const healthRes = await fetch(`${baseUrl}/api/admin/system-health`);
    assert.equal(healthRes.status, 403);

    const internalColRes = await fetch(`${baseUrl}/api/collections/active_sessions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [] }),
    });
    assert.ok(internalColRes.status === 401 || internalColRes.status === 403);
  });

  it('authenticates Super Admin and seeds a storefront product without exposing costPrice publicly', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin', pin: ADMIN_PIN }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = (await loginRes.json()) as {
      ok: boolean;
      sessionToken: string;
      user: { role: string };
    };
    assert.equal(loginJson.ok, true);
    assert.equal(loginJson.user.role, 'super_admin');
    assert.ok(loginJson.sessionToken);
    adminToken = loginJson.sessionToken;

    const createProdRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        id: testProductId,
        name: 'Governance Test Winter Shawl',
        urduName: 'ٹیسٹ شال',
        category: 'Fashion & Apparel',
        costPrice: 850,
        ourPrice: 1450,
        marketPrice: 1950,
        stockQty: 10,
        unit: 'piece',
        deliveryType: 'standard',
        deliveryFeeType: 'default',
        isUpcoming: false,
      }),
    });
    assert.equal(createProdRes.status, 200);

    const publicProdsRes = await fetch(`${baseUrl}/api/products`);
    assert.equal(publicProdsRes.status, 200);
    const publicProdsJson = (await publicProdsRes.json()) as {
      products: Array<{ id: string; costPrice: number; stockQty: number }>;
    };
    const seeded = publicProdsJson.products.find((p) => p.id === testProductId);
    assert.ok(seeded);
    assert.equal(seeded.costPrice, 0);
    assert.equal(seeded.stockQty, 10);
  });

  it('processes guest checkout and guarantees idempotent replay without double stock deduction', async () => {
    const idemKey = `idem_gov_${Date.now()}`;
    const payload = {
      idempotencyKey: idemKey,
      items: [{ productId: testProductId, quantity: 2 }],
      codOrder: {
        id: `cod_gov_${Date.now()}`,
        orderNumber: `MM-2026-${Math.floor(10000 + Math.random() * 89999)}`,
        customerName: 'Bilal Ahmed',
        phone: '03001234567',
        whatsapp: '03001234567',
        whatsappSameAsPhone: true,
        city: 'Lahore',
        area: 'Model Town',
        address: 'House 14, Block C, Model Town, Lahore',
        items: [],
        subtotal: 2900,
        deliveryCharge: 250,
        totalAmount: 3150,
        status: 'pending',
        createdAt: new Date().toISOString(),
        paymentMode: 'cod',
      },
    };

    const firstRes = await fetch(`${baseUrl}/api/orders/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idemKey,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(firstRes.status, 200);
    const firstJson = (await firstRes.json()) as {
      ok: boolean;
      idempotentReplay?: boolean;
      order: { orderNumber: string; totalAmount: number };
      guestClaimToken?: string;
      whatsappNotification?: { customerWaUrl?: string };
    };
    assert.equal(firstJson.ok, true);
    assert.ok(!firstJson.idempotentReplay);
    assert.ok(firstJson.order.orderNumber);
    assert.ok(firstJson.guestClaimToken);
    assert.ok(firstJson.whatsappNotification?.customerWaUrl?.includes('wa.me/'));
    placedOrderNumber = firstJson.order.orderNumber;
    guestClaimToken = firstJson.guestClaimToken!;

    // Replay with exact same idempotencyKey
    const replayRes = await fetch(`${baseUrl}/api/orders/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idemKey,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(replayRes.status, 200);
    const replayJson = (await replayRes.json()) as {
      ok: boolean;
      idempotentReplay?: boolean;
      order: { orderNumber: string };
    };
    assert.equal(replayJson.ok, true);
    assert.equal(replayJson.idempotentReplay, true);
    assert.equal(replayJson.order.orderNumber, placedOrderNumber);

    // Verify stock deducted ONCE (10 -> 8, NOT 6)
    const prodRes = await fetch(`${baseUrl}/api/products`);
    const prodJson = (await prodRes.json()) as { products: Array<{ id: string; stockQty: number }> };
    const updated = prodJson.products.find((p) => p.id === testProductId);
    assert.equal(updated?.stockQty, 8);
  });

  it('tracks guest order publicly and supports optional customer registration with RBAC guards', async () => {
    const badTrack = await fetch(`${baseUrl}/api/public/track-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber: placedOrderNumber, phone: '03990000000' }),
    });
    assert.ok(badTrack.status >= 400);

    const goodTrack = await fetch(`${baseUrl}/api/public/track-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber: placedOrderNumber, phone: '03001234567' }),
    });
    assert.equal(goodTrack.status, 200);
    const trackJson = (await goodTrack.json()) as {
      ok: boolean;
      order: { orderNumber: string; items: Array<{ quantity: number }> };
    };
    assert.equal(trackJson.ok, true);
    assert.equal(trackJson.order.orderNumber, placedOrderNumber);
    assert.equal(trackJson.order.items[0].quantity, 2);

    // Attempting to claim guest history without proof fails with 409
    const blockedReg = await fetch(`${baseUrl}/api/auth/register-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bilal Ahmed',
        phone: '03001234567',
        city: 'Lahore',
        address: 'Model Town',
      }),
    });
    assert.equal(blockedReg.status, 409);

    // Claiming with guestClaimToken + orderNumber succeeds with unguessable temp password
    const okReg = await fetch(`${baseUrl}/api/auth/register-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bilal Ahmed',
        username: 'bilal_gov_test',
        phone: '03001234567',
        city: 'Lahore',
        address: 'Model Town',
        guestClaimToken,
        orderNumber: placedOrderNumber,
        generateTempPassword: true,
      }),
    });
    assert.equal(okReg.status, 200);
    const regJson = (await okReg.json()) as {
      ok: boolean;
      sessionToken: string;
      temporaryPassword?: string;
      user: { id: string; role: string };
    };
    assert.equal(regJson.ok, true);
    assert.equal(regJson.user.role, 'customer');
    assert.ok(regJson.temporaryPassword && regJson.temporaryPassword.length >= 8);
    assert.notEqual(regJson.temporaryPassword, '234567');
    customerToken = regJson.sessionToken;
    customerUserId = regJson.user.id;

    // Registered customer must still be denied Admin System Health (403)
    const custHealthRes = await fetch(`${baseUrl}/api/admin/system-health`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.equal(custHealthRes.status, 403);
  });

  it('streams real-time SSE connected & sync events cleanly', async () => {
    const controller = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(sseRes.status, 200);
    assert.ok(sseRes.body);

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read initial connected packet
    while (!buffer.includes('event: connected')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    assert.ok(buffer.includes('event: connected'));

    // Trigger a mutation while SSE stream is open
    const updateRes = await fetch(`${baseUrl}/api/products/${encodeURIComponent(testProductId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: 'Governance Test Winter Shawl v2' }),
    });
    assert.equal(updateRes.status, 200);

    while (!buffer.includes('event: sync')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    assert.ok(buffer.includes('"resource":"products"'));
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // expected on abort
    }
  });

  it('creates verified SHA-256 backup, runs dry-run restore test, reports real System Health & revokes sessions immediately', async () => {
    const backupRes = await fetch(`${baseUrl}/api/admin/backup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(backupRes.status, 200);
    const backupJson = (await backupRes.json()) as {
      ok: boolean;
      backup: { file?: string; jsonFile?: string; sha256: string };
    };
    const backupFileName = backupJson.backup.file || backupJson.backup.jsonFile;
    assert.equal(backupJson.ok, true);
    assert.ok(backupFileName);
    assert.ok(backupJson.backup.sha256);

    const verifyRestoreRes = await fetch(`${baseUrl}/api/admin/backups/verify-restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ fileName: backupFileName }),
    });
    assert.equal(verifyRestoreRes.status, 200);
    const vrJson = (await verifyRestoreRes.json()) as {
      ok: boolean;
      verification: { sha256Valid: boolean; status: string };
      lastRestoreTest: { status: string; sha256Match: boolean };
      summary: { dryRun: boolean; totalRecordsInFile: number };
    };
    assert.equal(vrJson.ok, true);
    assert.equal(vrJson.verification.sha256Valid, true);
    assert.equal(vrJson.lastRestoreTest.status, 'passed');
    assert.equal(vrJson.summary.dryRun, true);
    assert.ok(vrJson.summary.totalRecordsInFile > 0);

    const healthRes = await fetch(`${baseUrl}/api/admin/system-health`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean; health: SystemHealthReport };
    assert.equal(healthJson.ok, true);
    const h = healthJson.health;
    assert.equal(h.backendStatus, 'ok');
    assert.equal(h.database.connected, true);
    assert.ok(h.database.latencyMs !== null && h.database.latencyMs >= 0);
    assert.equal(h.integrity.status, 'ok');
    assert.equal(h.backup.sha256Valid, true);
    assert.equal(h.lastRestoreTest?.status, 'passed');
    assert.ok(h.migrations.count > 0);
    assert.ok(h.storage.dataBytes > 0);
    assert.ok(h.sessions.activeSessionsCount >= 2);
    assert.ok(h.sessions.activeList.some((s) => s.isCurrent));

    const custSession = h.sessions.activeList.find((s) => s.userId === customerUserId);
    assert.ok(custSession, 'Expected customer session in active sessions registry');

    // Revoke customer session and verify immediate rejection
    const revokeRes = await fetch(
      `${baseUrl}/api/admin/sessions/${encodeURIComponent(custSession!.sid)}/revoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    assert.equal(revokeRes.status, 200);

    const afterRevokeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ currentPin: '0000', newPin: '12345' }),
    });
    assert.equal(afterRevokeRes.status, 401);

    // Secondary Admin login -> /api/auth/logout -> verify revoked immediately
    const admin2LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin', pin: ADMIN_PIN }),
    });
    const admin2Json = (await admin2LoginRes.json()) as { sessionToken: string };
    assert.ok(admin2Json.sessionToken);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin2Json.sessionToken}` },
    });
    assert.equal(logoutRes.status, 200);

    const afterLogoutHealth = await fetch(`${baseUrl}/api/admin/system-health`, {
      headers: { Authorization: `Bearer ${admin2Json.sessionToken}` },
    });
    assert.equal(afterLogoutHealth.status, 403);
  });
});
