# POS HARDENING ACCEPTANCE MATRIX — 2026-09-16

هذه المصفوفة هي checklist تنفيذ/اختبار لمسار `development/pos-hardening-20260916`.

| Scenario | Expected |
|---|---|
| New order, no kitchen send | Pay hidden; Print disabled even with print permission |
| First kitchen send succeeds | Pay becomes available to `pos.payment.take`; Print becomes available to `pos.receipt.print` |
| Add new unsent item after first send | Pay/Print must exclude the unsent quantity |
| Send the new delta | Pay/Print must include the delta exactly once |
| View-only user | No Pay / Cancel / Transfer / Print actions |
| Pay-only user | Can settle sent-only amount; cannot edit/cancel/transfer |
| Print-only user | Can print sent-only open-order receipt; cannot pay |
| Held order without cancel permission | Cancel action hidden and server operation must reject direct call |
| Table order without transfer permission | Transfer entry points hidden and server operation must reject direct call |
| Concurrent kitchen send from two sessions | No duplicate send and no duplicate inventory deduction |
| Transfer fails mid-operation | No partial table/order state |

No scenario is marked complete here until focused tests and relevant integration/security tests pass.