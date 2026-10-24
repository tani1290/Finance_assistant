import 'package:finpro_mobile/core/models/account_model.dart';
import 'package:flutter_test/flutter_test.dart';

/// The mobile category list is an allow-list mirror of the backend
/// `AccountType` enum. `CASH_WALLET` and `CASH_IN_HAND` were added without
/// removing or renaming any existing value, because stored accounts still use
/// them.
void main() {
  group('AccountModel.accountTypeValues', () {
    test('contains the new cash categories and every legacy category', () {
      expect(
        AccountModel.accountTypeValues,
        containsAll(<String>[
          'BANK',
          'CASH',
          'WALLET',
          'CREDIT_CARD',
          'CASH_WALLET',
          'CASH_IN_HAND',
          'SAVINGS',
          'CURRENT',
          'OTHER',
        ]),
      );
      expect(AccountModel.accountTypeValues.toSet().length,
          AccountModel.accountTypeValues.length);
    });
  });

  group('labelForAccountType', () {
    test('uses friendly labels for the cash categories', () {
      expect(AccountModel.labelForAccountType('CASH_WALLET'), 'Cash Wallet');
      expect(AccountModel.labelForAccountType('CASH_IN_HAND'), 'Cash in Hand');
      expect(AccountModel.labelForAccountType('CASH'), 'Cash');
      expect(AccountModel.labelForAccountType('WALLET'), 'Wallet');
    });

    test('never shows raw snake_case for an unknown future category', () {
      expect(AccountModel.labelForAccountType('DIGITAL_GOLD'), 'Digital Gold');
    });
  });

  group('fromJson', () {
    Map<String, dynamic> base(String type) => <String, dynamic>{
          'id': 'a1',
          'name': 'Purse',
          'accountType': type,
          'balance': 125.5,
          'currency': 'INR',
          'isActive': true,
        };

    test('accepts the new categories and exposes their label', () {
      final wallet = AccountModel.fromJson(base('CASH_WALLET'));
      final hand = AccountModel.fromJson(base('CASH_IN_HAND'));

      expect(wallet.accountType, 'CASH_WALLET');
      expect(wallet.accountTypeLabel, 'Cash Wallet');
      expect(wallet.isCashLike, isTrue);
      expect(hand.accountType, 'CASH_IN_HAND');
      expect(hand.accountTypeLabel, 'Cash in Hand');
      expect(hand.isCashLike, isTrue);
    });

    test('normalises case and whitespace from the wire', () {
      final account = AccountModel.fromJson(base('  cash_in_hand  '));
      expect(account.accountType, 'CASH_IN_HAND');
    });

    test('keeps the historical BANK default when the field is absent', () {
      final json = base('BANK')..remove('accountType');
      expect(AccountModel.fromJson(json).accountType, 'BANK');
    });

    test('bank and card categories still require a masked number', () {
      expect(AccountModel.fromJson(base('BANK')).isCashLike, isFalse);
      expect(AccountModel.fromJson(base('SAVINGS')).isCashLike, isFalse);
      expect(AccountModel.fromJson(base('CREDIT_CARD')).isCashLike, isFalse);
    });
  });
}
