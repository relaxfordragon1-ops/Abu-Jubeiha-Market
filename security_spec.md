# Abu Jubeiha Marketplace — Firestore Security Spec (Phase 0)

## 1. Core Data Invariants
1. **Identity & Email Verification**: All standard write operations require an authenticated user with `request.auth.token.email_verified == true`.
2. **PII Isolation**: User email addresses and phone numbers in `/users/{userId}/private/info` are readable only by the owner (`request.auth.uid == userId`) or verified staff.
3. **RBAC Privilege Integrity**: Non-admin users cannot set `role`, `isBlocked`, or `isVerifiedAccount` on `/users/{userId}`, nor write to `/admins/{uid}` unless their verified email is bootstrapped or pre-authorized in `/designatedStaff/{email}`.
4. **Ad Moderation Gate**: Standard users can only create ads with `status == 'pending'`, `isFeatured == false`, `hasVerifiedDocs == false`, and `viewsCount == 0`. Only staff can set `status == 'approved'` or `isFeatured == true`.
5. **Hero Promotion Integrity**: Standard users can only submit paid hero banner requests with `status == 'pending'`; only staff can activate (`status == 'active'`) or adjust `sortOrder`.
6. **Message Privacy**: Chat messages can only be read or created by participants (`senderId == uid` on create, `senderId == uid || receiverId == uid` on read), and only `receiverId` can mark `isRead: true`.
7. **Server Timestamps**: `createdAt` and `updatedAt` must strictly equal `request.time`.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Self-Admin Escalation on Profile Create**: Creating `/users/attackerUid` with `role: 'admin'` or `isVerifiedAccount: true`.
2. **Profile Role Escalation Update**: Updating `/users/attackerUid` adding `isBlocked: false` or `role: 'moderator'`.
3. **PII Scraping**: Reading `/users/victimUid/private/info` as another signed-in user.
4. **Unverified Email Spoof**: Writing to `/admins/spoofUid` when `email_verified` is `false` even if `email` matches an admin email.
5. **Auto-Approving Own Ad**: Creating `/ads/ad1` with `status: 'approved'` or `isFeatured: true` as a regular user.
6. **Impersonating Another Seller**: Creating `/ads/ad2` with `ownerId: 'victimUid'` while signed in as `attackerUid`.
7. **Shadow Field Injection on Ad Update**: Updating `/ads/ad1` with an unexpected ghost key `hasVerifiedDocs: true`.
8. **Mutating Immutable CreatedAt**: Updating `/ads/ad1` with a modified `createdAt` or `ownerId`.
9. **Terminal State Bypass**: Updating a `sold` ad back to `approved` as a non-staff user.
10. **Self-Activating Paid Hero Banner**: Creating `/heroPromotions/hp1` with `status: 'active'` as a non-staff user.
11. **Snooping Someone Else's Messages**: Querying `/messages` without filtering to `senderId == uid` or `receiverId == uid`.
12. **Resource Exhaustion / ID Poisoning**: Creating `/ads/<200-char-invalid-id>` or a `title` > 160 chars or `images` > 6 items.
