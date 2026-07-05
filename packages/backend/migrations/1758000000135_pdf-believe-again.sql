-- Believe Again: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'believe-again');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Mark 9:23–24', 'The Kindest Word Ever Spoken to a Doubter'),
  (2, 'James 2:26, 18', 'What You Believe, You Build With'),
  (3, 'Colossians 2:8', 'Where Your Beliefs Came From'),
  (4, '1 John 4:16', 'The First Stone: God Loves Me'),
  (5, 'Isaiah 40:8', 'Feelings Are Weather; the Word Is Climate'),
  (6, 'Romans 10:17', 'Faith Comes by Hearing — So Feed It'),
  (7, 'Hebrews 11:6', 'The Faith That Pleases Him'),
  (8, '2 Corinthians 4:13', 'Believing Has a Voice'),
  (9, 'James 2:18', 'Believing Has Feet'),
  (10, 'Psalm 139:14', 'Believe Well About Your Body'),
  (11, 'Galatians 6:4', 'Compare Only With Yourself'),
  (12, 'Romans 8:16', 'The Spirit Who Confirms'),
  (13, 'John 20:27', 'Doubt Is a Door, Not a Wall'),
  (14, 'Ephesians 3:20', 'Sign Your Declaration'),
  (15, 'Jude 20–21', 'A Foundation That Carries Weight')
) AS v(n, ref, title) WHERE p.code = 'believe-again';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'believe-again'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Mark 9:23–24', $dev$“If you can”? said Jesus. “Everything is possible for one who believes.” Immediately the boy’s father exclaimed, “I do believe; help me overcome my unbelief!”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$A desperate father brought Jesus a suffering son and a wounded faith: “If you can do anything…” Years of disappointment were packed into that little word “if.” Jesus caught it instantly — and instead of turning away, He opened a door the size of heaven: everything is possible for one who believes.

Then came the most honest prayer in the Bible: I do believe; help my unbelief. And here is the glory — Jesus answered it. He did not demand finished faith; He worked with a faith under construction.

That is the Christ you are rebuilding with. Bring Him your mixture of belief and doubt exactly as it is. This plan is not a test to pass; it is a construction site He has already agreed to supervise.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What is packed inside your “if” — which disappointments taught you to say it?

— Pray the father’s prayer over one specific area today.$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I do believe — help my unbelief. Take my faith as it is, under construction, and build it with Your own hands. Amen.

_May the Christ who works with unfinished faith begin His finest work in yours._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 9:14–29$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'James 2:26, 18', $dev$“As the body without the spirit is dead, so faith without deeds is dead… I will show you my faith by my deeds.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Watch any life closely and you can read its beliefs — not the stated ones, the operating ones. A man who believes opportunity is scarce hoards; a woman who believes she is unlovable withdraws before she can be left; a believer who believes God is stingy prays small prayers.

What you believe, you create — because belief is the raw material of behavior, and behavior, repeated, becomes a life. Jesus said it plainly: “According to your faith let it be done to you” (Matthew 9:29).

So begin the excavation: for each area of struggle, ask not “what am I doing wrong?” but “what must I be believing, for this behavior to make sense?” Write the answers down without shame. You cannot repour a foundation you have never inspected — and inspection is where the miracle of these fifteen days begins.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Pick one struggling area: what belief would make its patterns “make sense”?

— What does your prayer size reveal about your operating picture of God?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, give me the courage of inspection. Show me the operating beliefs beneath my behaviors — and let the digging begin without shame, under grace. Amen.

_May the inspection be gentle and the rebuilding be glorious._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 9:27–30; Proverbs 23:7$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Colossians 2:8', $dev$“See to it that no one takes you captive through hollow and deceptive philosophy, which depends on human tradition… rather than on Christ.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Nobody chooses their first beliefs. They were poured into you before you could evaluate them — by repeated words in childhood, by wounds that preached louder than sermons, by a culture’s assumptions, by the atmosphere of your home. A teacher’s careless sentence can govern a person for forty years.

This realization is liberating, not condemning: many things you have called “just how I am” are actually “just what I was told.” And what was installed by words and wounds can be uninstalled by truth and healing.

So today, trace two or three governing beliefs to their sources. Whose voice originally said it? Was that voice speaking truth — or pain? Honor what deserves honor, and mark for demolition whatever contradicts what Christ says. From now on, your beliefs must show a passport at the border: only what agrees with Him gets residence.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Trace your loudest limiting belief: whose voice installed it, and when?

— Was that voice speaking truth about you — or pain from their own story?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, sort the voices in my foundation. Keep what was true, heal what was wounded, and give residence only to what agrees with Christ. Amen.

_May every borrowed lie in your foundation lose its residence permit this week._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Colossians 2:6–10; Psalm 51:6$dev$),
  (4, 1, 'scripture', 'Today''s Reading', '1 John 4:16', $dev$“And so we know and rely on the love God has for us. God is love. Whoever lives in love lives in God, and God in them.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Every belief system needs a first stone, and here is yours: God loves me. Not generally — the whole world, averaged out — but specifically, presently, warmly. John, who leaned on Jesus’ chest, chose two verbs for it: we know and rely on the love God has for us. Not just acknowledge — rely on. Put weight on it, like a bridge.

Most cracked foundations crack here first. We believe God tolerates us, monitors us, is disappointed in us — and every other belief warps to match. But the cross is God’s once-for-all argument: “God demonstrates his own love for us in this: While we were still sinners, Christ died for us” (Romans 5:8).

Lay this stone deliberately today. Say it aloud, in first person, until your ears believe your mouth: God loves me. I rely on it. Everything else we build will stand on this.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Which counterfeit have you believed — tolerated, monitored, or loved?

— What would you attempt if you truly relied on His love like a bridge?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, I lay the first stone: You love me. Not averaged, not reluctant — demonstrated at the cross. Today I do not just admit it; I rely on it. Amen.

_May the first stone settle so deep that every storm after this finds it immovable._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$1 John 4:9–19; Romans 5:6–8$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Isaiah 40:8', $dev$“The grass withers and the flowers fall, but the word of our God endures forever.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Here is a decision that will change your spiritual life permanently: decide what gets the casting vote — your feelings or God’s Word. Feelings are weather: real, vivid, and gone by Thursday. The Word is climate: it endures forever.

Many believers live emotionally seasick because they re-vote their beliefs every morning based on how they woke up. Feeling condemned? Then I must be condemned. Feeling abandoned? Then God must be far. But feelings are witnesses, not judges — they report your state, they do not rule on truth.

Train the new reflex: when feeling and Scripture disagree, say — kindly, firmly — “I hear you, feeling. But it is written…” That was Jesus’ own sword in the wilderness, three times: it is written. Your emotions will not vanish; they will slowly resign as rulers and take their proper seat as servants.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which feeling most often out-votes the Word in your life?

— Find the “it is written” that answers it — memorize it today.$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I move the casting vote. Feelings may speak, but Your Word rules. Teach me Jesus’ reflex: it is written, it is written, it is written. Amen.

_May your inner climate grow so settled that no weather can rearrange it._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 40:6–8; Matthew 4:1–11$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Romans 10:17', $dev$“Consequently, faith comes from hearing the message, and the message is heard through the word about Christ.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Faith is not a talent some are born with; it is an appetite everyone can feed. Scripture tells you its diet precisely: faith comes by hearing — present, continuous — the word about Christ. Not by having heard, years ago. By hearing, today.

This explains the seasons your believing grew thin: check them, and you will usually find the hearing had grown thin first. Belief systems, like bodies, weaken on poor diets — and no one else can eat for you.

So build the feeding schedule: Scripture aloud daily (your own voice counts as hearing), anointed preaching through the week, testimonies rehearsed at your table, worship filling your house. Fill the ears and the heart follows; fill the heart, and believing stops being effort and becomes overflow.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Audit your ears: what have they been fed this month, and what has it grown?

— Design your faith diet: what will you hear daily, weekly?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, I take responsibility for my faith’s diet. Fill my ears with the word about Christ until believing becomes the overflow of hearing. Amen.

_May your ears eat well this week — and your faith show the feeding._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 10:14–17; Joshua 1:8$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Hebrews 11:6', $dev$“And without faith it is impossible to please God, because anyone who comes to him must believe that he exists and that he rewards those who earnestly seek him.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Faith is the role player in all becoming — the hand that receives what grace provides. And today’s verse tells us why heaven prizes it: faith honors God’s character. It believes two things about Him — that He is, and that He rewards seekers. Unbelief, at its root, is an insult dressed as humility: it quietly testifies that God is either absent or stingy.

Read Hebrews 11’s honor roll and notice what it celebrates: not perfect people, but people who took God at His word and moved — Noah building, Abraham leaving, Sarah conceiving, Moses choosing.

Your believing matters more than you know. Every act of trust — praying again, sowing again, hoping again — pleases the heart of God like few things in the universe. Today, do one thing purely because you believe He rewards those who seek Him.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has “humility” been hiding unbelief in your life?

— What one act of trust will you perform today, purely to please Him?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, I want to please You — so I choose to believe: You are, and You reward seekers. Receive my small acts of trust as the worship they are. Amen.

_May heaven smile today over your smallest act of trust._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 11:1–6; John 20:29$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '2 Corinthians 4:13', $dev$“It is written: “I believed; therefore I have spoken.” Since we have that same spirit of faith, we also believe and therefore speak.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Belief that never reaches the mouth remains a private opinion; belief spoken becomes a governing force. The spirit of faith has a grammar: I believed; therefore I have spoken. Abraham was renamed aloud. David answered Goliath aloud. Jesus commanded storms aloud.

Speaking does something to the believer as much as to the situation: your own ears are your most faithful congregation, and they attend every sermon your mouth preaches. Speak doubt and you disciple yourself downward; speak the Word and you disciple yourself into your own becoming.

So give your rebuilt beliefs a daily voice. Take the stones you have laid — God loves me; His Word out-votes my feelings; He rewards my seeking — and read them aloud each morning. A belief system with a voice becomes a belief system with a spine.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— What has your most faithful congregation — your own ears — been hearing from you?

— Write your morning declarations from this plan’s stones. Begin tomorrow.$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, give my believing a voice. I will speak what I believe until what I believe shapes what I see. I believed; therefore I speak. Amen.

_May your mouth become your faith’s best friend from today._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$2 Corinthians 4:13–18; Romans 10:9–10$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'James 2:18', $dev$“But someone will say, “You have faith; I have deeds.” Show me your faith without deeds, and I will show you my faith by my deeds.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$After voice comes feet. Belief is proven at the point of action: Peter’s faith was measured not by his opinion of water-walking but by his leg over the side of the boat. “Faith by itself, if it is not accompanied by action, is dead” (James 2:17).

Notice how Scripture’s miracles ride on obedient movement: lepers cleansed as they went; Jordan parted when priests’ feet entered the water; the man’s withered hand restored as he stretched it out. Heaven loves to meet motion.

So convert one rebuilt belief into one scheduled action this week. Believe He provides? Sow something. Believe He calls you? Volunteer somewhere. Believe He forgives? Have the reconciliation conversation. Do not wait to feel bold; act at the size of your current faith, and watch faith grow at the pace of your feet.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which belief from this plan is still waiting for feet?

— Schedule it: what action, what day, this week?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Lord, my faith requests walking papers. Show me this week’s one obedience, and I will move — lepers were healed as they went, and so will I be. Amen.

_May your feet catch up with your faith — and your miracles meet you mid-stride._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$James 2:14–26; Luke 17:11–14$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Psalm 139:14', $dev$“I praise you because I am fearfully and wonderfully made; your works are wonderful, I know that full well.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Your belief system includes a file marked “my body” — and for many, that file is full of complaints. We stand before mirrors like critics before an exhibit, itemizing what we would return to the Maker. But hear David’s settled verdict: fearfully and wonderfully made — and he knew it full well.

Remember the deep truth from the book of your becoming: “a body you prepared for me” (Hebrews 10:5). Your frame was custom-built for your specific assignment — the height, the face, the complexion, the wiring. Industries profit from your dissatisfaction; whole economies are funded by people convinced they are mistakes needing correction. Refuse the propaganda.

Steward your body — feed it well, rest it, keep it strong — but never despise it. You cannot become your best while at war with the vessel that carries you. Appreciate what was prepared for you.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— What is written in your “my body” file — complaint or praise?

— Thank God specifically for three features you have criticized.$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Maker of my frame, I close the complaints file and open the praise file: I am fearfully and wonderfully made — and my body was prepared for my assignment. I receive it with thanks. Amen.

_May you and the body that carries you finally sign a peace treaty — witnessed by its Maker._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139:13–16; 1 Corinthians 6:19–20$dev$),
  (11, 1, 'scripture', 'Today''s Reading', 'Galatians 6:4', $dev$“Each one should test their own actions. Then they can take pride in themselves alone, without comparing themselves to someone else.”$dev$),
  (11, 2, 'devotional', 'Devotional', NULL, $dev$Comparison is the termite of belief systems — it hollows out confidence quietly, from the inside. Paul names the folly: those who “measure themselves by themselves and compare themselves with themselves are not wise” (2 Corinthians 10:12). The instrument itself is broken.

You don’t compare your success with the people around you; you measure your progress against your own God-given potential and assignment. You can be ahead of everyone nearby and still below your own book — failure wearing a garland. Or behind everyone nearby and exactly on course in your book — success wearing rags.

When Peter compared his road to John’s, Jesus ended the audit in seven words: “What is that to you? You must follow me” (John 21:22). Run in your lane — the race “marked out for us” (Hebrews 12:1). The lanes were drawn by a Father who has no second-favorite children.$dev$),
  (11, 3, 'talk', 'Talk it Over', NULL, $dev$— Whose lane have you been running your race against?

— Measured against your own book — not their lane — how are you actually doing?$dev$),
  (11, 4, 'devotional', 'Pray', NULL, $dev$Father, I withdraw from every race You never entered me in. One lane, one book, one Judge. I will test my own work and run marked-out ground with joy. Amen.

_May your eyes stay so fixed on your own lane that comparison starves for attention._$dev$),
  (11, 5, 'reading', 'Go Deeper', NULL, $dev$Galatians 6:1–5; John 21:18–22$dev$),
  (12, 1, 'scripture', 'Today''s Reading', 'Romans 8:16', $dev$“The Spirit himself testifies with our spirit that we are God’s children.”$dev$),
  (12, 2, 'devotional', 'Devotional', NULL, $dev$A rebuilt belief system needs more than arguments; it needs a Witness — and God has placed one inside you. The Holy Spirit testifies with your spirit: a deep, quiet confirmation, beneath moods, that you are God’s child.

This is the role of the Holy Spirit in becoming: He takes what is objectively true and makes it inwardly unshakable. He reminds you of the Word when lies come recruiting (John 14:26); He pours God’s love into your heart (Romans 5:5); He is the deposit guaranteeing everything promised (Ephesians 1:13–14).

So involve Him by name in this reconstruction. When old beliefs whisper at midnight, do not argue alone — ask: Spirit of God, testify. Tell me again whose I am. He has never once declined that prayer. A belief confirmed by the Witness within cannot be talked out of you from without.$dev$),
  (12, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you been arguing with lies alone, or calling the Witness?

— Where do you most need His inner “testimony” this week?$dev$),
  (12, 4, 'devotional', 'Pray', NULL, $dev$Holy Spirit, Witness within, testify to my spirit — of the Father’s love, my sonship, my book in heaven. Make the truth unshakable where arguments cannot reach. Amen.

_May the Witness within you speak louder than every accusation without._$dev$),
  (12, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 8:14–17; John 14:25–27$dev$),
  (13, 1, 'scripture', 'Today''s Reading', 'John 20:27', $dev$“Then he said to Thomas, “Put your finger here; see my hands… Stop doubting and believe.”$dev$),
  (13, 2, 'devotional', 'Devotional', NULL, $dev$Thomas missed one meeting and declared his terms: unless I touch the wounds, I will not believe. For a week, heaven let him sit with his doubt — then Jesus walked through a locked door and offered him exactly what he had asked for: put your finger here.

Mark the kindness: no lecture, no shaming, no demotion from the twelve. The risen Christ made a personal appointment with one doubter’s specific conditions — and out of that encounter came the highest confession in the gospels: “My Lord and my God!”

Doubt handled honestly is a door: bring it to Jesus, state it plainly, stay in the room with the disciples while you wait. Doubt handled dishonestly — nursed in isolation, worn as sophistication — hardens into a wall. Yours can be a Thomas story: a week of questions, then a lifetime of unshakable confession.$dev$),
  (13, 3, 'talk', 'Talk it Over', NULL, $dev$— What are your honest “unless” conditions? Have you told Jesus, plainly?

— What keeps you “in the room” while you wait — and are you staying there?$dev$),
  (13, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, here are my doubts, stated plainly. I stay in the room. Come through my locked doors, and turn my questions into “My Lord and my God!” Amen.

_May your honest doubts receive personal appointments with the risen Christ._$dev$),
  (13, 5, 'reading', 'Go Deeper', NULL, $dev$John 20:24–29$dev$),
  (14, 1, 'scripture', 'Today''s Reading', 'Ephesians 3:20', $dev$“Now to him who is able to do immeasurably more than all we ask or imagine, according to his power that is at work within us…”$dev$),
  (14, 2, 'devotional', 'Devotional', NULL, $dev$There is a moment in every rebuilding when inspection ends and occupancy begins. Today is that moment: put your rebuilt belief system in writing, over your own name.

My Declaration of Becoming: I declare that I am not an accident — I was chosen before the foundation of the world, and my days are written in God’s book. I declare that God loves me, and I rely on it. His Word out-votes my feelings. He rewards my seeking. My body was prepared for my assignment. I run in my own lane. The Witness within me confirms whose I am. I will speak these things, act on these things, and contend for everything written about me — until I become everything God created me to be.

Sign it. Date it. Post it where your mornings will find it. Documents outlast moods — and this one has heaven’s countersignature.$dev$),
  (14, 3, 'talk', 'Talk it Over', NULL, $dev$— Which line of the declaration costs you most to sign — and why?

— Where will you post it so your mornings meet it?$dev$),
  (14, 4, 'devotional', 'Pray', NULL, $dev$Father, I sign — not because my faith is finished, but because Yours never fails. Countersign my declaration with Your Spirit, and hold me to it kindly all my days. Amen.

_May the document you sign today still be governing your descendants’ courage._$dev$),
  (14, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 3:14–21; Habakkuk 2:2$dev$),
  (15, 1, 'scripture', 'Today''s Reading', 'Jude 20–21', $dev$“But you, dear friends, by building yourselves up in your most holy faith and praying in the Holy Spirit, keep yourselves in God’s love…”$dev$),
  (15, 2, 'devotional', 'Devotional', NULL, $dev$Fifteen days ago you inherited a foundation; today you own one. But hear the commissioning in Jude’s verbs: building — present continuous. Belief systems are not monuments; they are living structures, maintained by hearing, speaking, acting, fellowship and prayer in the Spirit.

And remember why heaven rebuilt you: foundations exist to carry weight. God does not renovate believers for museum display — greater assignments are coming that your old cracked slab could never have supported: the vision He will show you, the people He will send you, the battles ahead in this journey.

Jesus finished His greatest sermon with a builder’s warning and promise: rains will come to every house — and the house on the rock stands (Matthew 7:24–25). Rains will come to yours. Let them. You have been rebuilding on rock.$dev$),
  (15, 3, 'talk', 'Talk it Over', NULL, $dev$— What maintenance rhythm will keep your foundation strong — name your weekly practices?

— What “weight” do you sense God preparing your rebuilt foundation to carry?$dev$),
  (15, 4, 'devotional', 'Pray', NULL, $dev$Father, keep me building — hearing, speaking, acting, praying in the Spirit. Load the weight You have prepared; this house is on the Rock, and the Rock does not move. Amen.

_May every storm that visits your rebuilt house leave a testimony instead of damage._$dev$),
  (15, 5, 'reading', 'Go Deeper', NULL, $dev$Jude 20–25; Matthew 7:24–27$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
