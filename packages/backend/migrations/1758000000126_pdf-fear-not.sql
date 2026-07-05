-- Fear Not: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'fear-not');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'John 14:27', 'The Gift Has Already Been Given'),
  (2, 'Isaiah 41:10', 'The Most Repeated Command'),
  (3, '2 Timothy 1:7', 'Fear Is a Visitor, Not a Landlord'),
  (4, 'Mark 4:38–39', 'The Storm and the Pillow'),
  (5, 'Philippians 4:6–7', 'Trade Your Worry for Worship'),
  (6, '1 Peter 5:7', 'Cast It — and Leave It There'),
  (7, 'Matthew 6:26', 'The Sparrow Ledger'),
  (8, 'Proverbs 29:25', 'Free From the Fear of Faces'),
  (9, '1 John 4:18', 'The Love That Evicts Fear'),
  (10, 'Matthew 14:29–30', 'Eyes on Him, Feet on Water')
) AS v(n, ref, title) WHERE p.code = 'fear-not';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'fear-not'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'John 14:27', $dev$“Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Begin with this settled fact: Jesus did not promise to send you peace someday. He left it — the way a man leaves an inheritance. My peace I give you. The peace that slept through a storm, stood silent before Pilate, and walked to a cross without panic — that very peace has your name on it.

The world gives peace conditionally: peace if the money comes, peace if the results are good, peace if people approve. Jesus gives “not as the world gives” — His peace is anchored outside your circumstances entirely, in His finished work.

So this journey does not begin with your effort. It begins with an inheritance you may simply have never unpacked.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What condition has your peace been waiting for — "I will rest when…"?

— What would today look like if you treated peace as already yours?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I receive the peace You left for me. I stop waiting for conditions and I start unpacking the inheritance. Quiet my heart with what You have already finished. Amen.

_May the peace of Christ stand guard over your heart and mind today._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$John 14:25–27; Isaiah 9:6$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Isaiah 41:10', $dev$“So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$The command God repeats most in Scripture is not about holiness, giving, or even love. It is fear not. Again and again, to shepherds and kings, to prophets and fishermen, the first word from heaven is almost always the same: do not be afraid.

Why so often? Because your Father knows your frame. He is not surprised or offended by your anxiety; He planned ahead for it, the way a parent packs food for a journey knowing the child will get hungry.

And notice the reason attached: not “fear not, for the danger is small,” but “fear not, for I am with you.” Heaven's answer to fear has never been better circumstances. It has always been closer company.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— When fear speaks tonight, what "for I am with you" truth will you answer it with?

— Where in your life have you been asking God for better circumstances when He is offering closer company?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You that You never tire of telling me not to fear. Teach my heart the reason: You are with me. Strengthen me, help me, uphold me today. Amen.

_May you feel the nearness of God in the very place you used to feel alone._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 41:8–13; Deuteronomy 31:8$dev$),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:7', $dev$“For God has not given us a spirit of fear, but of power and of love and of a sound mind.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Fear itself is not sin — it is an alarm system, designed by God to protect you from real danger for short moments. The trouble begins when the alarm never switches off; when a visitor is given the master bedroom. Anxiety is fear that has signed a lease.

Paul tells Timothy the truth that evicts it: the spirit of fear was not given by God. What God gave you is power, love and a sound mind — a mind that can be gathered, ordered, and settled.

You are allowed to feel the alarm. You are not obligated to house the tenant. Today, begin addressing fear as what it is: a visitor overstaying a welcome it was never given.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Which fear has quietly moved from visitor to landlord in your life?

— What does it change to know that the fear you carry was never given to you by God?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, I receive what You have given — power, love and a sound mind — and I release what You never gave. Fear, you are a visitor; in Jesus' name, the lease is cancelled. Amen.

_May every fear that outstayed its welcome leave your house today._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 1:6–10; Romans 8:15$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Mark 4:38–39', $dev$“Jesus was in the stern, sleeping on a cushion. The disciples woke him and said to him, “Teacher, don’t you care if we drown?” He got up, rebuked the wind and said to the waves, “Quiet! Be still!””$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Same boat. Same storm. Same water. Twelve men in a panic — and one Man asleep on a cushion. The difference was not information; Jesus knew about the storm. The difference was authority: He knew who was in charge of the water.

Here is what the disciples discovered that night, and what you may discover this week: peace is not the absence of a storm. Peace is the presence of a Person in your boat. And the same voice that said “Quiet! Be still!” to the sea knows how to say it to a mind.

You do not need the storm to end before you rest. You need to remember who is aboard.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— What storm are you currently in — and where is Jesus in your picture of it?

— What would "sleeping on the cushion" look like in your situation this week?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You are in my boat, and that changes the boat. Speak over my winds and waves — and speak over my mind — the word You spoke that night: Quiet. Be still. Amen.

_May you rest tonight like a man who knows who is in his boat._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 4:35–41; Psalm 46:1–3, 10$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Philippians 4:6–7', $dev$“Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God… will guard your hearts and your minds in Christ Jesus.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Paul wrote these words from a prison cell, which means they are not theory. His instruction is wonderfully practical: anxiety is not merely to be resisted — it is to be redirected. Every worry is a prayer request wearing the wrong clothes.

Notice the small phrase that carries the power: with thanksgiving. Worry rehearses what could go wrong; thanksgiving rehearses what God has already done right. The two cannot occupy the same sentence — which is exactly why heaven prescribes them together.

And the result is not that you guard your own heart. The peace of God garrisons it — a soldier posted at the door of your mind, checking every thought that seeks entry.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Take your loudest worry: what does it sound like re-dressed as a request with thanksgiving?

— What five things can you thank God for out loud, right now?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I bring You my worries dressed as requests. Thank You for every past faithfulness — I name them before You now. Post Your peace at the door of my mind today. Amen.

_May the peace that passes understanding garrison your heart today._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 4:4–9$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '1 Peter 5:7', $dev$“Cast all your anxiety on him because he cares for you.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$The word “cast” is a fisherman's word — Peter knew it well. It means to throw decisively away from yourself, the way a net leaves the hand. It does not mean to dangle your anxiety over the water while keeping a grip on the rope.

Most of us do not struggle to pray about our worries; we struggle to leave them where we prayed them. We hand God the burden and take it back on the way out, like a man who checks in luggage and then carries it onto the plane.

And look at the reason the verse gives — not “because you are strong,” but because He cares for you. The basis of the casting is His affection. You can release what you carry because you are carried.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Which anxiety have you prayed about many times but never actually released?

— What ritual of release could help you — writing it down, speaking it out, opening your hands?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, today I do not dangle my anxiety — I cast it. Take the weight of the thing I have carried too long. And when my hands reach for it again, remind me: I am carried. Amen.

_May your shoulders forget the shape of the burden you cast today._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$1 Peter 5:6–11; Psalm 55:22$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Matthew 6:26', $dev$“Look at the birds of the air; they do not sow or reap or store away in barns, and yet your heavenly Father feeds them. Are you not much more valuable than they?”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Jesus' cure for financial anxiety was to point at birds. Not because provision doesn't matter — He was speaking to poor people who knew real hunger — but because birds keep a different ledger. They receive today's food today, and sing anyway.

Then He asks the question that resets everything: are you not much more valuable than they? Anxiety about provision is, at its root, a question about your value to the Provider. And heaven has already answered it — at Calvary, in blood.

Notice, too, His timeframe: “do not worry about tomorrow.” God gives grace in daily bread, never in warehouse quantities. Today's grace is for today's needs. Tomorrow's is already scheduled.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Is your anxiety mostly about today's needs — or about tomorrows that have not arrived?

— What is today's bread — the actual provision you already have for this actual day?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, feed me today like You feed the birds, and teach me to sing on the branch while I wait. I trust You for tomorrow — I will meet its grace when I meet its needs. Amen.

_May you find today's table already set, and tomorrow's already planned._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 6:25–34; Exodus 16:4$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Proverbs 29:25', $dev$“Fear of man will prove to be a snare, but whoever trusts in the Lord is kept safe.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Not all fear has claws and darkness. Some fear wears a familiar face: the parent you can never please, the crowd you dress for, the opinions you check before you obey God. Scripture calls it the fear of man, and it is a snare — a trap that catches destinies.

The freedom is not to stop caring about people; it is to stop being ruled by them. One holy fear displaces a thousand small ones: when God's opinion becomes the loudest voice in your life, every other verdict becomes information, not identity.

The becoming life cannot be lived on the approval of spectators. You have an Audience of One, and He is already applauding the person He made you to be.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Whose disapproval do you fear most — and what has that fear cost you?

— What obedience have you delayed because of a face?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, unhook my heart from the verdicts of people. Let Your voice be the loudest in my life, Your pleasure my prize. I choose the safety of trusting You. Amen.

_May the only face you live to please be the One that shines upon you._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 29:25; Galatians 1:10; John 12:42–43$dev$),
  (9, 1, 'scripture', 'Today''s Reading', '1 John 4:18', $dev$“There is no fear in love. But perfect love drives out fear, because fear has to do with punishment.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Here is the deepest surgery of this whole plan. Beneath most chronic fear lies one buried question: am I truly safe with God? Fear “has to do with punishment” — it thrives wherever we secretly suspect that the rod is still coming, that we are one mistake from being cast out.

Perfect love answers the question permanently. At the cross, the punishment question was settled — “the punishment that brought us peace was on him” (Isaiah 53:5). You are not one mistake from rejection; you are one Savior from it, forever.

Loved people fear less. Not because their circumstances improve, but because their foundation does. Let His love go deeper than your alarm system today.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you secretly relate to God as a probation officer or as a Father?

— Where would fear lose its grip if you were certain — bone-deep — that you are loved?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, let Your perfect love reach the room where my oldest fear lives. Settle the punishment question in my heart forever at the cross. Love me brave. Amen.

_May perfect love walk through your heart today and turn every fear out of doors._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$1 John 4:16–19; Romans 8:31–39$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Matthew 14:29–30', $dev$““Come,” he said. Then Peter got down out of the boat, walked on the water and came toward Jesus. But when he saw the wind, he was afraid…”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Peter walked on water — remember that part. We tell this story as a failure, but a fisherman stood on the sea, and he managed it exactly as long as his eyes stayed on Christ. He sank not when the wind grew stronger, but when his attention changed address.

This is your commissioning: the becoming life will keep calling you out of boats, and the wind will keep auditioning for your attention. Fear is finally not conquered by analyzing the waves; it is conquered by a fixed gaze — “fixing our eyes on Jesus, the pioneer and perfecter of faith” (Hebrews 12:2).

And even Peter's sinking preaches: the moment he cried out, immediately Jesus caught him. The worst day of your faith still ends in His grip.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Where is Jesus saying "Come" — and what wind keeps stealing your gaze?

— Which practice from these ten days will you keep for life?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I step out. When the wind shouts, fix my eyes; when I sink, catch me immediately. I choose a life of walking toward You — whatever the water does. Amen.

_May you live the rest of your days with your eyes on Him — and may every storm under your feet become a floor._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 14:22–33; Hebrews 12:1–3$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
