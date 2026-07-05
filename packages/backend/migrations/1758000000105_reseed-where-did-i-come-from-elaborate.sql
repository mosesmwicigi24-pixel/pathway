-- Reseed where-did-i-come-from with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Ask most people where they come from and they will name a town, a tribe, a family. But go quiet with your own heart tonight and a deeper question surfaces: where did I really begin — and does my beginning make me matter? For some of us that question carries an ache, because our earthly beginnings were taught to us as things to hide: the village, the poverty, the family name, the story of how we arrived.

Paul takes us further back than any of it. Before the creation of the world, he says, God chose you — and He did it in Christ. Ephesians opens not with your birth, not with your parents' plans, but with a decision made in eternity, before there were stars to number or a womb to be formed in. Your existence was not heaven improvising around your circumstances. Heaven's decision came first.

Sit with what that dislodges. You were not an accident of biology, not the byproduct of someone else's choices, not a person scrambling after the fact to earn a seat at the table. Scripture calls this being chosen "before the foundation of the world" (Ephesians 1:4) — the same grace "given us in Christ Jesus before the beginning of time" (2 Timothy 1:9). You are a fore-thought, not an afterthought. Loved on purpose. Placed on purpose.

That truth has to touch the ground somewhere, and today the ground is your self-talk. The way you speak to yourself in the mirror, the ceilings you quietly accept, the apologies you make for where you started — measure them now against a beginning older than the universe. The person life told you to be ashamed of was chosen by God before the world had a shape.

Everything else in these ten days simply unpacks what was already true before the beginning: you did not start where you think you started.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— If your true origin is older than creation, what changes about the way you'll speak to yourself this week?

— Which "earthly beginning" — a place, a family story, a label — have you allowed to define you until now?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You that my true beginning is not a town or a bloodline but a choice You made in Christ before the world was formed. I lay down the shame of my earthly start and take up the glory of my eternal one. Teach me to live as one who was wanted before I existed. Amen.

_May you carry yourself today like a fore-thought of God._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 1:3–6; 2 Timothy 1:9$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Acts 17:26', $dev$“From one man he made all the nations, that they should inhabit the whole earth; and he marked out their appointed times in history and the boundaries of their lands.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Stand in any crowded market and watch the faces go by — a thousand shades, a hundred languages, every kind of story. It is easy to believe we are a scattered species with nothing in common but the ground under our feet. Paul, preaching to sophisticated Athenians who prided themselves on their pedigree, says something that would have unsettled the room: you all come from one man.

He is standing on Mars Hill, addressing philosophers who divided the world into Greeks and barbarians, the refined and the rest. Into that ranking Paul drops a leveling truth: from one man God made every nation, and He appointed their times and their borders. Underneath every tribe, color, class and passport, humanity shares a single origin — and that origin bears the fingerprints of God.

This one truth performs two rescues at once. It ends inferiority: no human being alive is made of finer material than you — not the wealthy, not the famous, not the ones who intimidate you in a room. And it ends superiority in the same breath: no one is made of lesser material either. "Have we not all one Father? Did not one God create us?" (Malachi 2:10). The ground of human worth is perfectly, stubbornly level.

So take the whisper your background handed you — too poor, too rural, wrong family, wrong side of town — and hold it up against your actual bloodline. One blood. One Maker. One image stamped on all of it. And then let the same truth search you the other way: is there anyone you have quietly filed beneath yourself? The level ground cuts in both directions.

You come from the same stock as kings — and so does the person you were tempted to look down on.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has your background been allowed to rank you beneath others — and is that ranking actually true?

— Is there anyone you have quietly ranked beneath yourself, whom "one blood" now asks you to see differently?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$God of all nations, thank You for the level ground of one blood. Heal me of the inferiority that shrinks me and cleanse me of the superiority that puffs me up. Let me take my place in the one family of mankind with quiet dignity, and grant the same dignity to everyone I meet. Amen.

_May you never again bow to a hierarchy heaven never built._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:24–28; Malachi 2:10$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Genesis 1:27', $dev$“So God created mankind in his own image, in the image of God he created them; male and female he created them.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$In the ancient world, a king who conquered a distant province could not stand in every town himself, so he did the next best thing: he set up images of himself across the land. The statue announced to everyone who passed it — this territory belongs to the king. His likeness was his claim.

Now read Genesis with that picture in mind, and feel the shock of it. When God moved to fill the earth with His likeness, He did not carve statues. He made people. "So God created mankind in his own image." You are not a random arrangement of cells that happened to become clever. You are heaven's declaration planted in your neighborhood — a walking sign that says this life, this place, this person belongs to God.

This is why human worth is not something you achieve; it is something you carry. If we were made from the first man in the image of God, then that image is stamped on the porter and the president alike — the same royal crest, regardless of résumé. Sin has cracked the image in all of us, but cracked is not erased. And here is the hope: in Christ the restoration is already underway. Paul says we are being renewed "in knowledge in the image of our Creator" (Colossians 3:10).

So carry it consciously today. The way you speak about yourself, the standards you set, the hopes you allow — let them match the dignity of an image-bearer, not the small self your worst season told you to accept. And then extend it outward: the difficult coworker, the person society overlooks, the one easy to dismiss — each bears the same crest, and honoring it in them is part of honoring it in you.

You come from God, you resemble God, and by grace you are growing back into the family likeness.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you treat yourself as an image-bearer — in your words about yourself, your standards, your hopes?

— Whose image-bearing dignity do you most need to start honoring, in the way you speak to and about them?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Creator God, I bear Your image — let me carry it consciously today rather than forgetting it by noon. Restore in me the family likeness that sin has cracked, and teach me to honor Your image in every person I meet, especially the ones I am tempted to overlook. Amen.

_May the family resemblance grow visibly in you this season._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 1:26–31; Colossians 3:9–10$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 139:16', $dev$“Your eyes saw my unformed body; all the days ordained for me were written in your book before one of them came to be.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Some days life feels random — a series of accidents you are trying to survive, with no author and no plan. If that is where you are, David has a word that reaches under the randomness and holds it still.

If there is one character trait that runs through the whole of Scripture, it is God's meticulous record-keeping. Genealogies preserved for thousands of years. Censuses counted and counted again. The hairs of your head numbered. Even your tears collected — "put my tears in your bottle; are they not in your book?" (Psalm 56:8). Heaven, it turns out, is a place of books. And David makes the staggering claim that you are written in them: before your first day arrived, all your days were already recorded.

Notice what that does to your birth. Your birth did not begin your story — it published a manuscript that was already complete in the mind of God. You are not an entry in the world's statistics, an anonymous number in a census of billions. You are a volume in heaven's library: authored, dated, and shelved with intention.

And a person who knows they are recorded lives differently from a person who feels random. When the plot turns strange — the delay, the detour, the chapter that made no sense while you were living it — the one who feels random despairs, while the one who trusts the Author waits. Not every chapter explains itself in the moment; but "written in your book before one of them came to be" means none of them caught God off guard.

You are not an accident heaven is scrambling to redeem. You are a page He wrote on purpose — so live today like one.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Does your life currently feel random or recorded — and what would honestly change if you believed the book?

— Which of your "chapters" makes more sense when you assume it was known and written in advance?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You that my days were written before they were lived — that I am not a random event but a recorded life. Where my story feels chaotic, remind me there is an Author. Help me live today like a page You carefully wrote. Amen.

_May you feel the dignity of a life that heaven wrote down._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139:13–18; Psalm 56:8$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Psalm 139:13–14', $dev$“For you created my inmost being; you knit me together in my mother’s womb. I praise you because I am fearfully and wonderfully made.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Watch someone knit and you notice how unhurried it is — loop by loop, colors chosen on purpose, every stitch counted. Nothing about it is mass production. That is the exact image David reaches for to describe how you were made: not stamped out on an assembly line, but knit, by hand, by Someone paying attention.

He is describing the hidden work of the womb, but the wonder runs deeper than biology. Your frame, your face, your temperament, the particular wiring of your mind — knit together on purpose by Hands that do not slip. And David's response to this is not clinical analysis; it is worship. "I praise you because I am fearfully and wonderfully made." He looks at himself and the first word out of his mouth is praise.

Be honest — for many of us that has never been the first word. We have filed complaints about how we were made far more often than we have offered thanks. The nose we were teased about. The sensitivity we were told to toughen out of. The mind that works differently than the room around it. We have treated these as flaws to apologize for rather than stitches chosen by a Craftsman.

Today, reverse the file. Take one feature you have resented and look at it again as a chosen stitch — not a mistake God is embarrassed by, but a detail He selected. "We are the clay, and you are our potter" (Isaiah 64:8); the Potter does not despise His own work. What would it sound like for you to actually thank Him for how you are made, out loud, today?

The Craftsman does not knit accidents. He knit you.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which "stitch" in your design have you most resented — and can you begin to consider that it was chosen, not accidental?

— What would it actually sound like to genuinely praise God for how you are made?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Master Craftsman, I withdraw my complaints and I bring You praise instead: I am fearfully and wonderfully made. Where I have resented Your handiwork, open my eyes to see the purpose in every stitch. Let me meet Your delight the next time I catch my own reflection. Amen.

_May you catch the Craftsman's delight when you next pass a mirror._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139:13–16; Isaiah 64:8$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Genesis 2:7', $dev$“Then the Lord God formed a man from the dust of the ground and breathed into his nostrils the breath of life, and the man became a living being.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Pick up a handful of soil and let it run through your fingers. Common. Ordinary. Free. And yet Genesis says that is where you came from — the dust of the ground, the same material as the field you walk across. It is a humbling origin, and it is only half the story.

Because the dust lay there, shaped but lifeless, until God did something no other creature received. "He breathed into his nostrils the breath of life, and the man became a living being." You did not become you when the body was formed. You became you when God exhaled. The breath moving in and out of your lungs at this very moment is on loan from that first divine breath.

This explains something you have felt your whole life and maybe never named: why nothing on earth fully satisfies you. You are a spirit, housed in a body, made alive by the breath of God — and dust alone was never going to be enough to feed a spirit. Solomon saw the whole arc of it: "the dust returns to the ground it came from, and the spirit returns to God who gave it" (Ecclesiastes 12:7). "The breath of the Almighty gives them understanding" (Job 32:8). You came from Him, and you are wired to return to Him.

Which means the restlessness is not a defect to be medicated away with more things, more noise, more dust. It is a compass. If you keep trying to satisfy a spiritual origin with only physical supplies, you will keep feeling the hunger. But if you turn toward the One your spirit came from — even in one honest breath of prayer today — the compass finds its north.

Your origin explains your homesickness. It also names your home.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you been trying to satisfy a spiritual origin with only physical supplies — and how has that gone?

— What one practice would help you "live toward" the One your spirit actually came from?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Breath of God, You are the life in my lungs and the home of my spirit. I confess I have tried to feed my spirit with dust. Turn my restlessness into a compass, and draw me daily toward the One I came from. Amen.

_May every breath today remind you whose exhale you are._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 2:7; Ecclesiastes 12:7; Job 32:8$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Acts 17:26–27', $dev$“…he marked out their appointed times in history and the boundaries of their lands. God did this so that they would seek him and perhaps reach out for him and find him.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Most of us have, at some point, quietly wished we had been born somewhere else — a wealthier country, an easier era, a family with more open doors. We treat the ground under us as the thing standing between us and the life we were meant to have. Paul, still on Mars Hill, gently takes that complaint apart.

You were not only made on purpose, he says — you were placed on purpose. God "marked out their appointed times in history and the boundaries of their lands." Your century, your country, your city, the year of your birth, the season of your strength — none of it was random assignment. It was marked out. And astonishingly, Paul gives the reason for the placement: "so that they would seek him and perhaps reach out for him and find him."

Read that again, because it re-frames everything. Your coordinates were not chosen to limit you; they were chosen as the best possible ground for you to find God — and for the people around you to find Him through you. The village or the crowded capital, the hard neighborhood or the quiet town, was selected with your seeking in mind.

So stop apologizing for your ground. The soil you were planted in is not the obstacle to your becoming; it is the appointed field of it. And there is a second calling folded inside the first: someone standing near your appointed ground is meant to meet God because you are there. Who might that be — the neighbor, the colleague, the family member — for whom your placement is their appointment?

"He is not far from any one of us." Not from you, and not from the ground where He planted you.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you treated your birthplace and your era as a limitation to escape or an appointment to steward?

— Who around your "appointed ground" might come to find God simply through your faithful presence there?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, I accept my coordinates — my land, my times, my ground. I stop wishing I had been planted somewhere else. You placed me here to seek You and to be found by others; make my placement fruitful, and show me the ones I was set here to reach. Amen.

_May your appointed ground begin to look like holy ground._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:26–28; Esther 4:14$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Colossians 1:15', $dev$“The Son is the image of the invisible God, the firstborn over all creation.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$We all correct ourselves in front of some mirror. We compare our lives, our faces, our worth against a reference point — usually without noticing we are doing it. And here is the quiet tragedy: most of the mirrors we use are cracked, and we have been adjusting ourselves to a distorted picture for years.

Paul offers a mirror that does not lie. "The Son is the image of the invisible God." If you want to know what you came from — and what you are becoming — do not study your relatives, and do not study your critics. Study Christ. He is the exact image of the invisible God, and therefore the perfect picture of everything humanity was made to be. He is the true mirror in front of which the rest of us finally see ourselves rightly.

Think about the mirrors you have been using. Family mirrors pass down their cracks — the anxieties, the labels, the "you're just like so-and-so." Culture's mirrors change shape every year and never stop moving the standard. And the mirror of your worst day lies outright, insisting the failure is the whole truth about you. Adjust yourself to any of these and you will grow crooked.

But look long at Jesus — His courage under pressure, His compassion toward the overlooked, His unbroken communion with the Father — and you are looking at your origin and your destination in the same frame. And something happens while you look: "we all... beholding as in a mirror the glory of the Lord, are being transformed into the same image from glory to glory" (2 Corinthians 3:18). Beholding is becoming. We grow toward whatever we gaze at.

So choose your mirror carefully — because you are already turning into the reflection you spend your time studying.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which cracked mirror — a family voice, a cultural standard, a worst day — has most shaped how you see yourself?

— What specific trait of Christ will you deliberately "behold" this week, knowing you become what you gaze at?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, perfect image of the invisible God, be my mirror. As I behold You, correct in me every distortion the cracked mirrors have left. Transform me, as I gaze, from glory to glory, until I look more like the One I came from. Amen.

_May the mirror of Christ show you both where you came from and where you are going._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Colossians 1:15–20; 2 Corinthians 3:18$dev$),
  (9, 1, 'scripture', 'Today''s Reading', '1 Corinthians 15:45, 49', $dev$“So it is written: “The first man Adam became a living being”; the last Adam, a life-giving spirit… And just as we have borne the image of the earthly man, so shall we bear the image of the heavenly man.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Every family passes down more than a surname. Somewhere in yours there are patterns — a temper, a fear, a way of leaving or of shutting down — that you have watched in your relatives and then felt stirring in yourself. From Adam, the first man, all of humanity inherited a rich gift and a real fracture at once: the image of God, yes, but also the weakness, the tendencies, the mortality of the earthly man.

Paul names both Adams on purpose. "The first man Adam became a living being; the last Adam, a life-giving spirit." He is announcing genealogy-changing news: there is a Second Adam, and in Christ you have been grafted into a new bloodline. Your family tree gained a branch that reaches higher than your oldest ancestor.

This is where the gospel gets intensely practical. "If anyone is in Christ, the new creation has come: The old has gone, the new is here!" (2 Corinthians 5:17). The pattern you assumed was simply "who you are" — the anger, the addiction, the anxiety that ran in the family line — is no longer your master. "Just as we have borne the image of the earthly man, so shall we bear the image of the heavenly man." A new likeness is now your inheritance, and it is stronger than the old one.

Notice this does not require you to despise your earthly family. You can honor the people you came from and still outgrow their fractures — in fact that is exactly what grace makes possible. You keep the love and you leave the pattern. You carry the surname and you break the curse.

Your truest ancestry is no longer only behind you. In Christ, it is above you — and it is winning.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which inherited pattern have you quietly assumed was simply "who you are" rather than something you can outgrow?

— What would it look like, this week, to live from the Second Adam's bloodline instead of the first's?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You for grafting me into the bloodline of the last Adam. I receive the inheritance of the heavenly Man and I release every fracture of the earthly one. Let me honor the family I came from even as I outgrow the patterns that were never Yours. Amen.

_May the new bloodline in you prove stronger than every old pattern._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 15:45–49; 2 Corinthians 5:17$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Acts 17:28', $dev$“For in him we live and move and have our being. As some of your own poets have said, “We are his offspring.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Ten days of tracing your ancestry, and here is the whole inheritance in one breath: you began in Christ before creation; you share one blood with all mankind; you bear the image of God; you were recorded, knit, breathed, and placed on purpose; the perfect mirror is Jesus; and your new bloodline outranks your old one. Paul gathers it into a single sentence: "In him we live and move and have our being... we are his offspring."

Now comes the part that turns a devotional into a commissioning. The point of knowing your origin is not to feel better about yourself for an afternoon. It is to change the direction you live in. Here is the difference: people who do not know where they come from spend their lives living toward an origin — auditioning for a worth they are trying to earn. People who know where they come from live from their origin — already secure, now free to spend themselves on the assignment.

Watch how that plays out in an ordinary week. The one still auditioning needs the promotion to feel valuable, needs the approval to feel loved, reads every silence as rejection. The one who lives from their origin can work hard without begging, love freely without clinging, and take a "no" without it touching their identity — because their worth was settled before the world began, and no boardroom or relationship can vote on it.

So cancel the audition. You do not need this world's permission to matter; the verdict came in before you arrived. You came from God, you live and move in Him right now, and one day you will return to Him with a finished book in your hands.

Walk out of this plan the way royalty walks out of a palace — not hoping to be someone, but knowing exactly whose house you come from.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— What audition — for approval, worth, belonging — can you finally cancel now that your origin is settled?

— From today on, how will you introduce yourself to yourself, in the words you use when no one is listening?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, in You I live and move and have my being. I cancel the auditions I have been running for approval and I take up the assignment You gave me instead. Let me live from my origin, not toward it, all the days written in Your book. Amen.

_May you walk out of this plan the way royalty walks out of a palace — knowing exactly whose house you come from._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:24–31; 1 John 3:1–2$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
