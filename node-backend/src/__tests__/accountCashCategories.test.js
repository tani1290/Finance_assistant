/**
 * Cash account categories — additive `CASH_WALLET` / `CASH_IN_HAND` support.
 *
 * These tests lock the account contract:
 *   - the new categories are accepted on create and edit,
 *   - every previously valid category still works,
 *   - an unsupported value is a 400 (never a Prisma 500),
 *   - an omitted create value keeps the historical BANK default,
 *   - an omitted edit value leaves the stored category untouched,
 *   - updates are scoped by userId (user isolation),
 *   - account totals include cash categories exactly once, and
 *   - the masked number survives serialisation so the edit form can prefill.
 *
 * Deterministic: Prisma is mocked. No database or network is touched.
 */

jest.mock('../config/database', () => ({
  financialAccount: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../config/database');
const {
  createAccount,
  updateAccount,
  getAccounts,
} = require('../controllers/accountController');

const USER = 'user-cash-categories';

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function reqFor(body = {}, params = {}) {
  return { user: { id: USER }, body, params };
}

const bodyOf = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.resetAllMocks();
});

describe('createAccount — category validation', () => {
  test.each(['CASH_WALLET', 'CASH_IN_HAND'])(
    'accepts %s and returns it unchanged',
    async (accountType) => {
      prisma.financialAccount.create.mockImplementation(async ({ data }) => ({
        id: 'acc-new',
        ...data,
        balance: data.balance,
        currency: 'INR',
      }));

      const res = makeRes();
      await createAccount(
        reqFor({
          name: '  Petty cash  ',
          accountType,
          institution: '  Drawer  ',
          balance: '1250.50',
        }),
        res,
        jest.fn()
      );

      expect(res.status).toHaveBeenCalledWith(201);
      expect(prisma.financialAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER,
          name: 'Petty cash',
          accountType,
          institution: 'Drawer',
          balance: 1250.5,
          currency: 'INR',
        }),
      });
      expect(bodyOf(res).success).toBe(true);
      expect(bodyOf(res).data.accountType).toBe(accountType);
    }
  );

  test('keeps the BANK default when accountType is omitted', async () => {
    prisma.financialAccount.create.mockImplementation(async ({ data }) => ({
      id: 'acc-default',
      ...data,
    }));

    const res = makeRes();
    await createAccount(reqFor({ name: 'Primary' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.financialAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountType: 'BANK' }),
    });
  });

  test('accepts a case-insensitive value and stores the canonical form', async () => {
    prisma.financialAccount.create.mockImplementation(async ({ data }) => ({
      id: 'acc-lower',
      ...data,
    }));

    const res = makeRes();
    await createAccount(
      reqFor({ name: 'Wallet', accountType: ' cash_wallet ' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.financialAccount.create.mock.calls[0][0].data.accountType).toBe(
      'CASH_WALLET'
    );
  });

  test('still accepts the pre-existing categories', async () => {
    for (const accountType of [
      'BANK',
      'CASH',
      'WALLET',
      'CREDIT_CARD',
      'SAVINGS',
      'CURRENT',
      'OTHER',
    ]) {
      jest.clearAllMocks();
      prisma.financialAccount.create.mockImplementation(async ({ data }) => ({
        id: 'acc-legacy',
        ...data,
      }));
      const res = makeRes();
      await createAccount(reqFor({ name: 'Legacy', accountType }), res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(bodyOf(res).data.accountType).toBe(accountType);
    }
  });

  test.each([['not-a-category'], [42], [{}]])(
    'rejects unsupported value %p with 400 VALIDATION_ERROR',
    async (accountType) => {
      const res = makeRes();
      await createAccount(reqFor({ name: 'Bad type', accountType }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(bodyOf(res)).toEqual({
        success: false,
        error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      });
      expect(prisma.financialAccount.create).not.toHaveBeenCalled();
    }
  );

  test('rejects a whitespace-only name', async () => {
    const res = makeRes();
    await createAccount(reqFor({ name: '   ' }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
  });
});

describe('updateAccount — cash categories and masked number', () => {
  const EXISTING = {
    id: 'acc-1',
    userId: USER,
    name: 'Wallet',
    accountType: 'WALLET',
    institution: 'Paytm',
    accountNumberMasked: '1111',
    balance: 500,
  };

  test('moves an account to CASH_IN_HAND and clears the mask when empty', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue(EXISTING);
    prisma.financialAccount.update.mockImplementation(async ({ data }) => ({
      ...EXISTING,
      ...data,
    }));

    const res = makeRes();
    await updateAccount(
      reqFor(
        { accountType: 'CASH_IN_HAND', accountNumberMasked: '', balance: 750 },
        { id: 'acc-1' }
      ),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.financialAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: expect.objectContaining({
        accountType: 'CASH_IN_HAND',
        accountNumberMasked: null,
        balance: 750,
      }),
    });
    expect(bodyOf(res).data.accountType).toBe('CASH_IN_HAND');
  });

  test('leaves the category untouched when accountType is omitted', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue(EXISTING);
    prisma.financialAccount.update.mockImplementation(async ({ data }) => ({
      ...EXISTING,
      ...data,
    }));

    const res = makeRes();
    await updateAccount(reqFor({ name: 'Renamed' }, { id: 'acc-1' }), res, jest.fn());

    const data = prisma.financialAccount.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('accountType');
    expect(bodyOf(res).data.name).toBe('Renamed');
  });

  test('rejects an invalid category before writing', async () => {
    prisma.financialAccount.findFirst.mockResolvedValue(EXISTING);

    const res = makeRes();
    await updateAccount(
      reqFor({ accountType: 'GOLD_BARS' }, { id: 'acc-1' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bodyOf(res).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.financialAccount.update).not.toHaveBeenCalled();
  });

  test("does not edit another user's account", async () => {
    prisma.financialAccount.findFirst.mockResolvedValue(null);

    const res = makeRes();
    await updateAccount(reqFor({ name: 'Hijack' }, { id: 'other-users-acc' }), res, jest.fn());

    expect(prisma.financialAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-users-acc', userId: USER },
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.financialAccount.update).not.toHaveBeenCalled();
  });
});

describe('getAccounts — cash categories in totals and serialisation', () => {
  test('sums cash categories exactly once and keeps the mask for edit prefill', async () => {
    prisma.financialAccount.findMany.mockResolvedValue([
      {
        id: 'a-bank',
        name: 'Salary',
        institution: 'HDFC',
        accountType: 'BANK',
        accountNumberMasked: '1234',
        balance: '10000.00',
        currency: 'INR',
        isActive: true,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        id: 'a-wallet',
        name: 'Paytm',
        institution: null,
        accountType: 'CASH_WALLET',
        accountNumberMasked: null,
        balance: '250.50',
        currency: 'INR',
        isActive: true,
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
      },
      {
        id: 'a-hand',
        name: 'Purse',
        institution: null,
        accountType: 'CASH_IN_HAND',
        accountNumberMasked: null,
        balance: '49.50',
        currency: 'INR',
        isActive: true,
        createdAt: new Date('2026-10-03T00:00:00.000Z'),
      },
    ]);

    const res = makeRes();
    await getAccounts(reqFor(), res, jest.fn());

    expect(prisma.financialAccount.findMany).toHaveBeenCalledWith({
      where: { userId: USER, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    const payload = bodyOf(res).data;
    expect(payload.totalBalance).toBe(10300);
    expect(payload.accounts).toHaveLength(3);
    expect(payload.accounts.map((a) => a.accountType)).toEqual([
      'BANK',
      'CASH_WALLET',
      'CASH_IN_HAND',
    ]);
    expect(payload.accounts[0].accountNumberMasked).toBe('1234');
    // A cash account is represented once, as an account row — there is no
    // second cash ledger entry to double count.
    expect(payload.totalBalance).toBe(
      payload.accounts.reduce((sum, a) => sum + a.balance, 0)
    );
  });

  test('does not leak another user accounts into the query', async () => {
    prisma.financialAccount.findMany.mockResolvedValue([]);
    const res = makeRes();
    await getAccounts(reqFor(), res, jest.fn());

    expect(prisma.financialAccount.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      isActive: true,
    });
    expect(bodyOf(res).data.totalBalance).toBe(0);
  });
});
