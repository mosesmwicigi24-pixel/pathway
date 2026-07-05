-- Healed of Rejection: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'healed-of-rejection');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Isaiah 53:3', 'The Rejected Christ Understands You'),
  (2, 'Psalm 147:3', 'Naming the Wound'),
  (3, 'Jeremiah 1:5', 'Known Before the Womb'),
  (4, 'Psalm 27:10', 'Though Father and Mother Forsake Me'),
  (5, 'Romans 12:2', 'The Lies the Wound Taught You'),
  (6, 'Ephesians 4:31–32', 'Hurting People Hurt People — Healed People Heal Them'),
  (7, 'Isaiah 49:15–16', 'Engraved on His Palms'),
  (8, 'Galatians 3:13–14', 'Redeemed From Every Curse'),
  (9, 'Psalm 34:5', 'Favor on Your Face'),
  (10, 'Ephesians 1:4, 6', 'Chosen — and Choosing to Bless')
) AS v(n, ref, title) WHERE p.code = 'healed-of-rejection';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'healed-of-rejection'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Isaiah 53:3', $dev$“He was despised and rejected by mankind, a man of suffering, and familiar with pain… he was despised, and we held him in low esteem.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Before we touch your wound, meet the One who carries the same scar. Jesus was misunderstood by His family, betrayed by His friend, denied by His disciple, exchanged for a criminal by the crowd He came to save, and — in the darkest moment in history — He cried, “My God, my God, why have you forsaken me?”

There is no rejection you have tasted that He has not drained to the bottom. When you pray about being unwanted, you are not explaining something foreign to Him; you are speaking His mother tongue.

And watch what heaven did with the rejected One: “the stone the builders rejected has become the cornerstone” (Psalm 118:22). That is the pattern of your healing. In the hands of God, rejected stones become cornerstones.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What does it change to know that Christ personally understands rejection from the inside?

— Where in your life might God be turning a rejected stone into a cornerstone?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, Man of Sorrows, You know this wound by name. I bring my rejection to the only One who was rejected more deeply and loved more perfectly. Begin Your healing in me today. Amen.

_May you feel deeply understood today — by the God who has felt what you feel._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 53:1–5; Psalm 118:22–23; Matthew 27:46$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Psalm 147:3', $dev$“He heals the brokenhearted and binds up their wounds.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$A wound cannot be healed while it is unnamed. So let us say it plainly: rejection is being cast aside, unwelcomed, devalued — thrown away as though worthless. At its root, rejection is the absence of love, and because every human being was created to love and be loved, that absence wounds us at the deepest level we have.

Perhaps yours came through divorce or a broken engagement; through comparison to a sibling; through abuse; through a cycle of failures; through unkind words that lodged like arrows. However it came, it was real, and God does not ask you to pretend otherwise.

But notice today's verse: He binds up wounds — which means heaven treats your wound as legitimate. You are not weak for hurting. You are human, and you are already on the Healer's schedule.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— If you traced your sense of being unwanted to its first door, where did it enter?

— Have you allowed yourself to call it a wound — or have you been calling it weakness?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I stop pretending. Here is my wound — I name it before You. Thank You that You do not despise the brokenhearted; You bind them up. I place myself under Your bandage today. Amen.

_May naming the wound today be the beginning of losing it forever._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 147:3; Psalm 34:18$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Jeremiah 1:5', $dev$“Before I formed you in the womb I knew you, before you were born I set you apart.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Some rejection begins before birth. A child conceived unplanned, unwanted, or arriving as the “wrong” gender can carry a sense of being an intrusion into the world — a guest nobody invited. If that is your story, today's word is surgery.

Whatever the circumstances of your conception, you were never God's accident. Before your mother knew you existed, your Maker knew you personally — knew you, set you apart, wrote your days in His book (Psalm 139:16). Human planning and divine purpose are two different registries, and heaven's registry has always had your name.

You were not merely allowed into the world. You were sent. There is a difference, and healing begins where that difference is believed.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you carried a quiet feeling of being an intrusion — a guest nobody invited?

— What changes when you replace “I happened” with “I was sent”?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, before the womb, You knew me. I renounce the lie that I am an accident, an intrusion, an inconvenience. I accept heaven's registry: I was set apart and sent. Amen.

_May the sent-ness of your life silence every whisper that you were unwanted._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Jeremiah 1:4–8; Psalm 139:13–18$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 27:10', $dev$“Though my father and mother forsake me, the Lord will receive me.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$The deepest rejections wear family faces. The absent father. The critical mother. The home where you learned to read moods before you learned to read books. Parental wounds cut deepest because parents were designed to be our first picture of God.

David's verse faces the worst case without flinching: though my father and mother forsake me. Even if the two people ordained to want you did not — the Lord will receive you. The word means to gather up, the way one lifts an abandoned child from the roadside and carries it home.

Your identity does not come from those who rejected you; it comes from the One who received you. People's rejection is information about their capacity, never a verdict on your value.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Has a family wound been shaping your picture of God? In what way?

— What would it mean to let the Lord “gather you up” in the exact place a parent let you down?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, where my first pictures of love were broken, paint Yours. I bring You the family wounds I have carried quietly for years. Receive me, gather me, and re-parent my heart. Amen.

_May the Father's receiving heal every place a parent's forsaking has touched._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 27:7–14; Isaiah 49:15–16$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Romans 12:2', $dev$“Do not conform to the pattern of this world, but be transformed by the renewing of your mind.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Rejection is a teacher, and it teaches lies. Its favorite is over-generalization: rejected by one man, we conclude “all men are the same”; betrayed by one friend, we mistrust every hand extended since. One person's failure becomes a doctrine about the whole human race — and innocent people pay an old bill they never owed.

The wound also builds a hard shell: we grow insensitive to protect ourselves from future hurts, and the armor that keeps pain out keeps love out with it.

Healing means letting Christ renew the mind the wound has trained. Not all people are your past. Today, gently, let one lie be named and retired: the next person is not the last person. Your future does not deserve your history's sentence.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— What “all people are…” doctrine did your wound write — and who is paying its bill today?

— Where has your protective shell been keeping out love along with hurt?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Lord, expose the lies my wound taught me and retire them one by one. Soften the shell without leaving me unguarded — You be my protection, so my heart can be open. Amen.

_May your heart un-learn the lies and stay soft — guarded by God, not by walls._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 12:2; Ezekiel 36:26$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Ephesians 4:31–32', $dev$“Get rid of all bitterness, rage and anger… Be kind and compassionate to one another, forgiving each other, just as in Christ God forgave you.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$There is a sobering law in the world of wounds: rejected people reject others; hurting people hurt people. The pain we do not transform, we transmit — to spouses, to children, to anyone standing close when the old wound is touched.

But the law works in the other direction too, and this is today's good news: healed people heal people. The kindness of a restored heart carries medicine into every room it enters.

The hinge between the two is forgiveness — and hear this clearly: forgiveness is not an emotion; it is a decision. It is not saying the rejection didn't matter; it is refusing to drink poison hoping the one who hurt you feels it. Release them into God's hands today — not because they deserve it, but because you deserve to be free.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Who has been receiving pain you did not transform?

— Whom do you need to release today by decision, even before feelings agree?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, I choose — by decision, not emotion — to forgive those who rejected me. I release them into Your hands and I take my heart back. Make me a healer of the very wound I carried. Amen.

_May the cycle break with you — and may your hands become healing hands._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 4:29–32; Matthew 18:21–35$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Isaiah 49:15–16', $dev$“Can a mother forget the baby at her breast and have no compassion on the child she has borne? Though she may forget, I will not forget you! See, I have engraved you on the palms of my hands.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$God reaches for the strongest human bond He can find — a nursing mother and her baby — and then says something astonishing: even if that bond fails, Mine will not. Human love, at its very best, can forget. Divine love cannot.

Then the image sharpens: I have engraved you on the palms of my hands. Not written in ink, which fades; engraved, cut in. And for the Christian, the image becomes literal — there are nail marks in the palms of Christ, and your name lives in them.

Every time the enemy says “forgotten,” heaven holds up two scarred hands. You are not an entry in God's diary. You are an engraving in His flesh.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— What situation has made you feel forgotten by God?

— What does it mean to you that your remembrance cost Christ His hands?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, when I feel forgotten, show me Your hands. I am engraved, not jotted; cut into Your palms, not penciled in Your margins. I rest in a love that cannot forget me. Amen.

_May you see your name in His palms every time the world overlooks you._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 49:13–16; John 20:24–29$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Galatians 3:13–14', $dev$“Christ redeemed us from the curse of the law by becoming a curse for us… He redeemed us in order that the blessing given to Abraham might come to the Gentiles through Christ Jesus.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Some rejection is not merely emotional; it functions like a shadow over a life — patterns of being overlooked, doors that close without reason, a script of exclusion that repeats. Whatever its source, hear the gospel's verdict: Christ has already dealt with every curse at its root.

He was made a curse for us — hung on the tree, rejected by earth and, for one dark hour, heaven — so that the blessing of Abraham could flow to you. The exchange is complete: His rejection purchased your acceptance; His exclusion purchased your welcome.

You do not need to break what Christ has already broken. You need to stand in the finished work: the shadow has no legal claim on a redeemed life. Walk out from under it, blessed.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you noticed repeating patterns of exclusion that feel bigger than circumstance?

— What does it mean to stand in an exchange that is already finished?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You became a curse so I could become blessed. I stand in that exchange now: every shadow of rejection over my life is cancelled at Your cross. I receive the blessing of Abraham. Amen.

_May the blessing purchased for you settle visibly on your life this week._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Galatians 3:10–14; Deuteronomy 28:1–14$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Psalm 34:5', $dev$“Those who look to him are radiant; their faces are never covered with shame.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Here is a secret about rejection: it shows. Walk into an interview carrying an old rejection and it sits in your posture, your eyes, your tone — and the room responds to what you carry. Wounded expectation has a way of manufacturing the very rejection it fears. That is why we need freedom — so that favor can show on our faces.

The Psalmist gives the beauty treatment of heaven: those who look to Him are radiant. Radiance is not cosmetics; it is the glow of a face that has been looking at unconditional love. Shame cannot survive on a face that beholds Him.

As healing settles in, expect the practical harvest: rooms will respond differently, because you will enter them differently. Favor is attracted to a healed countenance.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What have your face and posture been announcing before you speak?

— How can “looking to Him” become your daily beauty routine?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, heal my countenance. Let the old rejection drain from my eyes and Your radiance take its place. I will look to You until favor shows on my face. Amen.

_May people meet the favor on your face before they learn your name._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 34:1–8; Numbers 6:24–26$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:4, 6', $dev$“For he chose us in him before the creation of the world… to the praise of his glorious grace, which he has freely given us in the One he loves.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Ten days ago you began as the unwanted one. Hear your closing verdict: chosen before the creation of the world, adopted in love, accepted in the Beloved. The last word over your life was never rejection; it was election.

Now comes the commissioning, because healed people are given assignments. Become a chooser of others. Speak blessing over your children and refuse to compare them — each one is unique. Create warm memories; pray and play with them. Be present — they need your presence more than your presents. Dedicate them to God and prophesy good over their futures. And where there are no children, do this for every soul in your circle: welcome the unwelcomed, choose the overlooked.

The wound you carried is now a well others can drink from. That is the glory of God: nothing wasted, everything redeemed.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Who in your world is waiting to be chosen the way you have been chosen?

— What blessing will you speak over your children — or your circle — this very week?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, I stand accepted in the Beloved — chosen before the world began. Make me a chooser: my home a place of welcome, my words a fountain of blessing, my healed heart a well for the thirsty. Amen.

_May you never again introduce yourself as the rejected one — you are the chosen of God._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 1:3–14; 1 Peter 2:9–10$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
