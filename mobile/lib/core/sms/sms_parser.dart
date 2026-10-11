import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'sms_candidate.dart';

class SmsParser {
  static final RegExp _otpRegex = RegExp(
    r'\b(otp|one[\s-]?time[\s-]?password|verification[\s-]?code|secret[\s-]?code|auth[\s-]?code|security[\s-]?code|is\s+your\s+\d{4,8})\b',
    caseSensitive: false,
  );

  static final RegExp _promoRegex = RegExp(
    r'\b(apply\s+now|get\s+instant\s+loan|pre[\s-]?approved|click\s+here|congratulations|won|special\s+offer|discount\s+coupon|avail\s+now)\b',
    caseSensitive: false,
  );

  static final RegExp _requestRegex = RegExp(
    r'\b(has\s+requested|requested\s+(?:rs\.?|inr)|request\s+money|collect\s+request|pay\s+request)\b',
    caseSensitive: false,
  );

  static final RegExp _failedRegex = RegExp(
    r'\b(declined|failed|unsuccessful|failure|could\s+not\s+be\s+processed|transaction\s+declined)\b',
    caseSensitive: false,
  );

  static final RegExp _balanceOnlyRegex = RegExp(
    r'\b(?:avail(?:able)?\s+bal(?:ance)?|clear\s+balance|ledger\s+balance)\b',
    caseSensitive: false,
  );

  static String computeHash(String text) {
    final normalized = text
        .toLowerCase()
        .replaceAll(RegExp(r'[^\w\s]'), '')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    return sha256.convert(utf8.encode(normalized)).toString();
  }

  static SmsCandidate parse(String body, {String sender = 'BANK_SMS'}) {
    final hash = computeHash(body);
    final lower = body.toLowerCase();

    // 1. Strict Privacy & Non-Transaction Classification
    if (_otpRegex.hasMatch(lower)) {
      return SmsCandidate(
        isTransaction: false,
        rejectionReason: 'OTP / Verification Code',
        transactionDate: DateTime.now(),
        rawSender: sender,
        rawBody: body,
        messageHash: hash,
      );
    }

    if (_failedRegex.hasMatch(lower)) {
      return SmsCandidate(
        isTransaction: false,
        rejectionReason: 'Transaction Declined / Failed',
        transactionDate: DateTime.now(),
        rawSender: sender,
        rawBody: body,
        messageHash: hash,
      );
    }

    if (_requestRegex.hasMatch(lower)) {
      return SmsCandidate(
        isTransaction: false,
        rejectionReason: 'Payment Request',
        transactionDate: DateTime.now(),
        rawSender: sender,
        rawBody: body,
        messageHash: hash,
      );
    }

    final hasDebit =
        lower.contains('debited') ||
        lower.contains('spent') ||
        lower.contains('paid') ||
        lower.contains('withdrawn') ||
        lower.contains('purchase') ||
        lower.contains('transferred to');
    final hasCredit =
        lower.contains('credited') ||
        lower.contains('deposited') ||
        lower.contains('received') ||
        lower.contains('salary') ||
        lower.contains('refund');

    if (!hasDebit && !hasCredit) {
      if (_balanceOnlyRegex.hasMatch(lower)) {
        return SmsCandidate(
          isTransaction: false,
          rejectionReason: 'Balance Enquiry Only',
          transactionDate: DateTime.now(),
          rawSender: sender,
          rawBody: body,
          messageHash: hash,
        );
      }
      if (_promoRegex.hasMatch(lower)) {
        return SmsCandidate(
          isTransaction: false,
          rejectionReason: 'Promotional Offer',
          transactionDate: DateTime.now(),
          rawSender: sender,
          rawBody: body,
          messageHash: hash,
        );
      }
      return SmsCandidate(
        isTransaction: false,
        rejectionReason: 'No financial transaction keywords',
        transactionDate: DateTime.now(),
        rawSender: sender,
        rawBody: body,
        messageHash: hash,
      );
    }

    // 2. Extract Amount
    final parts = body.split(
      RegExp(
        r'(?:avl\s*bal|available\s*balance|bal\s*is|bal\s*inr|balance\s*:)',
        caseSensitive: false,
      ),
    );
    final txPart = parts.isNotEmpty ? parts[0] : body;

    double amount = 0.0;
    final amountMatch = RegExp(
      r'(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)',
      caseSensitive: false,
    ).firstMatch(txPart);
    if (amountMatch != null) {
      final rawNum = amountMatch.group(1)?.replaceAll(',', '') ?? '0';
      amount = double.tryParse(rawNum) ?? 0.0;
    }

    if (amount <= 0) {
      final fallbackMatch = RegExp(
        r'\b([\d,]+(?:\.\d{1,2})?)\s*(?:debited|credited|spent|withdrawn)',
        caseSensitive: false,
      ).firstMatch(txPart);
      if (fallbackMatch != null) {
        final rawNum = fallbackMatch.group(1)?.replaceAll(',', '') ?? '0';
        amount = double.tryParse(rawNum) ?? 0.0;
      }
    }

    if (amount <= 0) {
      return SmsCandidate(
        isTransaction: false,
        rejectionReason: 'Could not extract valid monetary amount',
        transactionDate: DateTime.now(),
        rawSender: sender,
        rawBody: body,
        messageHash: hash,
      );
    }

    // 3. Direction (DEBIT vs CREDIT)
    final direction = hasCredit && !hasDebit ? 'INCOME' : 'EXPENSE';

    // 4. Account Hint (last 4 digits)
    String? accountHint;
    final accMatch = RegExp(
      r'(?:a\/c|account|card)\s*(?:ending\s*)?(?:in\s*)?(?:xx|\*+|\.{2,})*(\d{3,6})',
      caseSensitive: false,
    ).firstMatch(body);
    if (accMatch != null) {
      accountHint = accMatch.group(1);
    }

    // 5. Merchant extraction & category suggestion
    String merchant = 'Merchant';
    String category = direction == 'INCOME' ? 'Income' : 'General';

    if (lower.contains('swiggy') ||
        lower.contains('zomato') ||
        lower.contains('mcdonald') ||
        lower.contains('starbucks')) {
      merchant = lower.contains('swiggy')
          ? 'Swiggy'
          : (lower.contains('zomato') ? 'Zomato' : 'Food & Dining');
      category = 'Food & Dining';
    } else if (lower.contains('blinkit') ||
        lower.contains('zepto') ||
        lower.contains('bigbasket') ||
        lower.contains('dmart')) {
      merchant = lower.contains('blinkit')
          ? 'Blinkit'
          : (lower.contains('zepto') ? 'Zepto' : 'Groceries');
      category = 'Groceries';
    } else if (lower.contains('uber') ||
        lower.contains('ola') ||
        lower.contains('petrol') ||
        lower.contains('fuel')) {
      merchant = lower.contains('uber')
          ? 'Uber'
          : (lower.contains('ola') ? 'Ola' : 'Transport');
      category = 'Transport';
    } else if (lower.contains('amazon') ||
        lower.contains('flipkart') ||
        lower.contains('myntra')) {
      merchant = lower.contains('amazon')
          ? 'Amazon'
          : (lower.contains('flipkart') ? 'Flipkart' : 'Shopping');
      category = 'Shopping';
    } else if (lower.contains('salary')) {
      merchant = 'Salary / Employer';
      category = 'Salary';
    } else {
      final atMatch = RegExp(
        r'(?:at|to|towards|info:\s*pos\/)\s*([A-Za-z0-9\s&'
        r'-]{2,25}?)(?=\s+(?:on|ref|avl|bal|\.|$))',
        caseSensitive: false,
      ).firstMatch(body);
      if (atMatch != null) {
        merchant = atMatch.group(1)?.trim() ?? 'Merchant';
      }
    }

    // 6. Bank Reference
    String? bankRef;
    final refMatch = RegExp(
      r'(?:upi\s*ref|rrn|ref\s*no\.?|ref:?)\s*[:#-]?\s*([A-Za-z0-9]{6,25})',
      caseSensitive: false,
    ).firstMatch(body);
    if (refMatch != null) {
      bankRef = refMatch.group(1)?.trim();
    }

    return SmsCandidate(
      isTransaction: true,
      amount: amount,
      currency: 'INR',
      direction: direction,
      merchant: merchant,
      accountHint: accountHint,
      bankReference: bankRef,
      transactionDate: DateTime.now(),
      suggestedCategory: category,
      confidence: 0.90,
      rawSender: sender,
      rawBody: body,
      messageHash: hash,
    );
  }
}
