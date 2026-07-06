-- Where Did I Come From?: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'where-did-i-come-from');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Ephesians 1:4', 'You Began in Christ'),
  (2, 'Acts 17:26', 'One Blood, One Family'),
  (3, 'Genesis 1:27', 'The Image You Bear'),
  (4, 'Psalm 139:16', 'The God of Records'),
  (5, 'Psalm 139:13–14', 'Woven in Secret'),
  (6, 'Genesis 2:7', 'The Breath That Makes You'),
  (7, 'Acts 17:26–27', 'Appointed Time, Appointed Ground'),
  (8, 'Colossians 1:15', 'The Perfect Mirror'),
  (9, '1 Corinthians 15:45, 49', 'A New Bloodline'),
  (10, 'Acts 17:28', 'Live From Your Origin')
) AS v(n, ref, title) WHERE p.code = 'where-did-i-come-from';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'where-did-i-come-from'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:4', $dev$“For he chose us in him before the creation of the world to be holy and blameless in his sight.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Where did you come from? The deepest answer is not a place — it is a Person. Before the world was created, God chose you in Him, in Christ. Your story does not begin at your birth, or even at your conception. It begins in the eternal counsel of God, before there were stars to count.

This means your existence was not a response to circumstances — not your parents' planning, nor their lack of it. Heaven's decision preceded every earthly one.

The becoming life is built on this rock: you are not an afterthought trying to earn a place. You are a fore-thought — loved, chosen, and placed. Everything else these ten days will simply unpack what was true before the beginning.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— How does it change your self-worth to date your origin before creation?

— What "earthly beginning" have you allowed to define you until now?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You that my true beginning is in Christ, before the world was formed. I trade the shame of my earthly beginnings for the glory of my eternal one. Amen.

_May you carry yourself today like a fore-thought of God._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 1:3–6; 2 Timothy 1:9$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Acts 17:26', $dev$“From one man he made all the nations, that they should inhabit the whole earth; and he marked out their appointed times in history and the boundaries of their lands.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$We are all made from one blood — from Adam. Underneath every tribe, color, class and passport, humanity shares a single origin, and that origin bears the fingerprints of God.

This truth performs two liberations at once. It ends inferiority: no human being on earth is made of finer material than you — not the wealthy, not the famous, not the powerful. And it ends superiority: no one is made of lesser material either. The ground of human worth is perfectly level.

Whatever your background whispered — too poor, too rural, wrong family, wrong side of town — your bloodline answers back: one blood, one Maker, one image. You come from the same stock as kings.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has your background been allowed to rank you beneath others?

— Is there anyone you have quietly ranked beneath yourself?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$God of all nations, thank You for the level ground of one blood. Heal me of inferiority and cleanse me of superiority. I take my place in the one family of mankind — with dignity. Amen.

_May you never again bow to a hierarchy heaven never built._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:24–28; Malachi 2:10$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Genesis 1:27', $dev$“So God created mankind in his own image, in the image of God he created them; male and female he created them.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$In the ancient world, kings placed images of themselves in distant provinces to declare: this territory is mine. Then Genesis makes its stunning announcement — God placed His image not in statues, but in people. You are heaven's declaration in your neighborhood.

If we were made from the first man, we truly bear the image and character of God. This is why every human life carries unnegotiable worth — the porter and the president bear the same crest.

Sin has cracked the image, but it has not erased it — and in Christ, the restoration is underway. You are being renewed “in the image of your Creator” (Colossians 3:10). You come from God, you resemble God, and by grace you are growing back into the family likeness.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you treat yourself as an image-bearer — in your words about yourself, your standards, your hopes?

— Whose image-bearing dignity do you most need to start honoring?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Creator God, I bear Your image — let me carry it consciously today. Restore in me the family likeness, and teach me to honor Your image in every person I meet. Amen.

_May the family resemblance grow visibly in you this season._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 1:26–31; Colossians 3:9–10$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 139:16', $dev$“Your eyes saw my unformed body; all the days ordained for me were written in your book before one of them came to be.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$If there is one character of God that runs through all of Scripture, it is His meticulous planning and record keeping. Genealogies preserved for millennia. Censuses counted twice. Hairs numbered. Tears kept in a bottle (Psalm 56:8). Heaven is a place of books.

And you are in them. Before your first day happened, all your days were written. Your birth did not begin your story; it published a manuscript that was already complete in the mind of God.

A person who knows they are recorded lives differently from a person who feels random. You are not an entry in the world's statistics. You are a volume in heaven's library — authored, dated, and shelved with intention.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Does your life currently feel random or recorded? What would change if you believed the book?

— Which of your "chapters" makes more sense when you assume it was known in advance?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You that my days were written before they were lived. I am not random; I am recorded. Help me live today like a page You authored. Amen.

_May you feel the dignity of a life that heaven wrote down._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139:13–18; Psalm 56:8$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Psalm 139:13–14', $dev$“For you created my inmost being; you knit me together in my mother’s womb. I praise you because I am fearfully and wonderfully made.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Knitting is slow, deliberate work — loop by loop, chosen colors, counted stitches. That is the Bible's picture of your formation: not mass production, but handcraft. Your frame, your face, your temperament, the wiring of your mind — knit, on purpose, by Hands that do not slip.

David's response was not analysis but praise: I praise you because I am fearfully and wonderfully made. Some of us have never once thanked God for how we are made; we have only filed complaints.

Today, reverse the file. The features you were teased for, the sensitivity you were told to toughen out of, the mind that works differently — inspect them again as chosen stitches. The Craftsman does not knit accidents.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which "stitch" in your design have you resented — and can you consider it chosen?

— What would it sound like to genuinely praise God for how you are made?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Master Craftsman, I withdraw my complaints and I bring praise: I am fearfully and wonderfully made. Teach me the purpose of every stitch I once resented. Amen.

_May you catch the Craftsman's delight when you next pass a mirror._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139:13–16; Isaiah 64:8$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Genesis 2:7', $dev$“Then the Lord God formed a man from the dust of the ground and breathed into his nostrils the breath of life, and the man became a living being.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Your body was formed from dust — common material, shared with the ground you walk on. But you did not become you until God exhaled. The breath in your lungs right now is on loan from that first divine breath.

This is why nothing on earth fully satisfies the human heart: you are a spirit, housed in a body, made alive by the breath of God — and “the dust returns to the ground it came from, and the spirit returns to God who gave it” (Ecclesiastes 12:7). You come from Him, and you are designed to return to Him — which means you are designed to live toward Him now.

Man is a spiritual being clothed in a physical body, and God will always interact with man at the spiritual level. Your origin explains your homesickness — and your destination.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you been trying to satisfy a spiritual origin with only physical supplies?

— What practice would help you "live toward" the One your spirit came from?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Breath of God, You are the life in my lungs and the home of my spirit. I stop feeding my spirit dust. Draw me daily toward the One I came from. Amen.

_May every breath today remind you whose exhale you are._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 2:7; Ecclesiastes 12:7; Job 32:8$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Acts 17:26–27', $dev$“…he marked out their appointed times in history and the boundaries of their lands. God did this so that they would seek him and perhaps reach out for him and find him.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$You were not only made on purpose — you were placed on purpose. Your century, your country, your city: marked out in advance. The Kenyan village or the crowded capital, the year of your birth, the era of your strength — appointments, all of them.

And Scripture even gives the reason for the placement: so that they would seek him and find him. Your coordinates were chosen as the best possible ground for you to find God — and for the people around you to find Him through you.

Stop apologizing for your ground. The soil you were planted in is not the obstacle to your becoming; it is the appointed field of it. Yet He is actually not far from each one of us.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you treated your birthplace and era as a limitation or an appointment?

— Who around your "appointed ground" might find God through your presence there?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, I accept my coordinates — my land, my times, my ground. You planted me here to seek You and to be found by others. Make my placement fruitful. Amen.

_May your appointed ground begin to look like holy ground._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:26–28; Esther 4:14$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Colossians 1:15', $dev$“The Son is the image of the invisible God, the firstborn over all creation.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$If you want to know what you came from — and what you are becoming — do not study your relatives. Study Christ. He is the exact image of the invisible God, and therefore the perfect picture of everything humanity was meant to be. Christ is the perfect image displayed in the mirror at which we correct ourselves.

Every other mirror distorts. Family mirrors pass down their cracks; culture's mirrors change shape yearly; the mirror of your worst day lies outright. But look long at Jesus — His courage, His compassion, His communion with the Father — and you are looking at your origin and your destination at once.

“As we behold Him, we are transformed into the same image, from glory to glory” (2 Corinthians 3:18). Beholding is becoming. Choose your mirror carefully.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which cracked mirror has most shaped your self-understanding?

— What specific trait of Christ will you "behold" deliberately this week?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, perfect image of the invisible God, be my mirror. As I behold You, correct in me every distortion the other mirrors left. Transform me from glory to glory. Amen.

_May the mirror of Christ show you both where you came from and where you are going._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Colossians 1:15–20; 2 Corinthians 3:18$dev$),
  (9, 1, 'scripture', 'Today''s Reading', '1 Corinthians 15:45, 49', $dev$“So it is written: “The first man Adam became a living being”; the last Adam, a life-giving spirit… And just as we have borne the image of the earthly man, so shall we bear the image of the heavenly man.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$From Adam you inherited much — the image of God, yes, but also the fracture: the tendencies, the weaknesses, the mortality of the earthly man. Some of what runs in your natural family line, you have felt running in you.

Here is the gospel's genealogy-changing news: there is a Second Adam, and in Christ you have been grafted into a new bloodline. “If anyone is in Christ, the new creation has come” (2 Corinthians 5:17). The old family patterns are no longer your masters; the heavenly Man's likeness is now your inheritance.

You honor your earthly family — and you outgrow its fractures. Your truest ancestry is no longer behind you. It is above you.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which inherited pattern have you assumed was simply "who you are"?

— What does it mean to live from the Second Adam's bloodline this week?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You for grafting me into the bloodline of the last Adam. I receive the inheritance of the heavenly Man, and I release every fracture of the earthly one. Amen.

_May the new bloodline in you prove stronger than every old pattern._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 15:45–49; 2 Corinthians 5:17$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Acts 17:28', $dev$“For in him we live and move and have our being. As some of your own poets have said, “We are his offspring.””$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Ten days of ancestry, and here is the summary: you began in Christ before creation; you share one blood with all mankind; you bear the image of God; you are recorded, knit, breathed, placed; the perfect mirror is Jesus; and your new bloodline outranks your old one. We are His offspring.

Now the commissioning: live from your origin, not toward it. People who do not know where they come from spend their lives seeking approval — auditioning for a worth they already possess. People who know their origin spend their lives on assignment.

You do not need this world's permission to matter. You came from God, you live and move in Him, and you will return to Him with a finished book. Walk accordingly.

You know your origin now — guard it, for every great becoming is built on it. Continue the journey: your next plan is Why Am I Here? — because the person who knows where they come from is finally ready to ask what they were sent to do. From The Power to Become by Moses Mwicigi.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— What audition can you finally cancel now that your origin is settled?

— How will you introduce yourself — to yourself — from now on?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, in You I live and move and have my being. I cancel the auditions and take up the assignment. I will live from my origin all the days written in Your book. Amen.

_May you walk out of this plan the way royalty walks out of a palace — knowing exactly whose house you come from._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:24–31; 1 John 3:1–2$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
