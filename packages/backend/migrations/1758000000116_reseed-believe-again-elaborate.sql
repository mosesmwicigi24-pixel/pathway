-- Reseed believe-again with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$A father stands at the edge of the crowd holding the hand of a son the disciples could not help. He has watched this boy convulse since childhood, has run out of doctors and out of hope, and when he finally reaches Jesus the best faith he can muster limps out as a question: “If you can do anything, take pity on us.” Notice the little word that carries a lifetime of disappointment — “if.” That word is where many of us live.

Read what happens next slowly, because it is one of the tenderest moments in the Gospels. Jesus catches the “if” and gently hands it back: everything is possible for one who believes. He does not scold the man for doubting; He simply widens the door. And the father answers with the most honest prayer in Scripture: “I do believe; help me overcome my unbelief!” In one breath he confesses both his faith and its fractures — and he brings the whole mixture to Jesus rather than tidying it up first.

Here is the truth the whole plan stands on: Jesus healed the boy anyway. He did not wait for the father to reach some qualifying level of certainty. He worked with a faith that was honest about its cracks (Mark 9:24–25). The Lord you are rebuilding your life with is astonishingly kind to strugglers. He is not scanning you for perfect belief; He is looking for a heart willing to say the true thing.

So bring Him your actual faith today — the real one, with its doubts still attached. Do not perform confidence you do not feel. Name the area where your “if” lives: the prayer you have stopped praying, the dream you have quietly buried, the promise you no longer expect. Say the father’s words over it out loud. This plan is not an exam you must pass before God shows up; it is a construction site He has already agreed to supervise.

You do not need finished faith to begin. You need honest faith — and a Christ who answers it.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What disappointment first taught you to say “if” — and which area of your life still carries it?

— Say the father’s prayer aloud over one specific situation today. What did it feel like to admit both your belief and your unbelief at once?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I do believe — help my unbelief. I bring You my faith exactly as it is, cracks and all, and I ask You to work with it rather than wait for it. Take my honest heart and begin Your finest work.

_May the Christ who healed a son through a doubting father’s prayer meet the honest faith you bring Him today._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 9:14–29$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'James 2:26, 18', $dev$“As the body without the spirit is dead, so faith without deeds is dead… I will show you my faith by my deeds.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Watch any life closely for a week and you will begin to read its beliefs — not the ones printed on the surface, but the operating ones underneath. The man who believes opportunity is scarce hoards and grasps. The woman who believes she is unlovable leaves relationships before she can be left. The believer who secretly thinks God is stingy prays small, safe prayers. What we truly believe leaks out through what we consistently do.

That is precisely James’ point. He is not attacking faith; he is insisting that living faith always leaves footprints. “I will show you my faith by my deeds,” he says — because belief is never just an idea filed in the mind. It is the raw material of behavior, and behavior repeated becomes a whole life. Jesus said the same thing when He healed two blind men: “According to your faith let it be done to you” (Matthew 9:29). What you carry inside eventually builds the house you live in.

So today we begin the excavation. For each area where you keep hitting the same wall, resist the usual question — “What am I doing wrong?” — and ask a deeper one: “What must I be believing, for this pattern to make sense?” The overspender may believe money proves worth. The people-pleaser may believe love must be earned. The one who never rests may believe God’s approval depends on output.

Get it on paper, and do it without shame. This is not a courtroom; it is an inspection, and inspection is the mercy that makes repair possible. Proverbs puts it plainly: “as he thinks in his heart, so is he” (Proverbs 23:7). You cannot repour a foundation you have never had the courage to look at.

Name the belief, and you have already loosened its grip. The digging you do today is where the rebuilding of the next two weeks begins.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Pick one area where you keep repeating the same result. What hidden belief would make that pattern “make sense”?

— What does the size of your prayers reveal about the picture of God you are actually operating on?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, give me the courage to inspect my own foundation. Show me the operating beliefs beneath my behaviors, and let the digging begin honestly — not under condemnation, but under grace. I trust You with what we find.

_May the inspection be gentle and the rebuilding be glorious._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 9:27–30; Proverbs 23:7$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Colossians 2:8', $dev$“See to it that no one takes you captive through hollow and deceptive philosophy, which depends on human tradition… rather than on Christ.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Nobody chooses their first beliefs. They were poured into you long before you could evaluate them — by words repeated over you in childhood, by wounds that preached louder than any sermon, by the unspoken assumptions of your culture, by the emotional weather of the home you grew up in. A teacher’s careless sentence can govern a person for forty years. A parent’s absence can install a belief about God that no argument seems able to dislodge.

Paul knew how this works, which is why he warns the Colossians about being “taken captive” by ideas that trace back to human tradition rather than to Christ. The word he uses pictures a prisoner led away — quietly, without a struggle, unaware it is even happening. Many of us are carrying beliefs like that: inherited, unexamined, and quietly running the show.

But hear the liberating side of this. If your limiting beliefs were installed by voices and wounds, then they were installed — which means they are not simply “who you are.” Much of what you have labeled “just how I am” is actually “just what I was told.” And what was put in by words and wounds can be taken out by truth and healing. That is not denial; it is repair.

So today, trace two or three governing beliefs back to their source. Whose voice first said it? What season did it enter? Was that voice speaking truth about you — or pain from its own unhealed story? Honor what deserves honoring; not every inherited belief is a lie, and some were gifts. But whatever contradicts what Christ says about you gets marked for demolition.

From this day forward, your beliefs must show a passport at the border. Only what agrees with Him is granted residence. God is not intimidated by the voice that wounded you — and neither, from today, are you.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Trace your loudest limiting belief to its origin: whose voice installed it, and in what season of your life?

— Was that voice speaking the truth about you — or its own pain? What does Christ say about you instead?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, sort the voices in my foundation. Keep what was true, heal what was wounded, and grant residence only to what agrees with Christ. Free me from every belief that quietly took me captive, and let Your Word have the final say over me.

_May every borrowed lie in your foundation lose its residence permit this week._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Colossians 2:6–10; Psalm 51:6$dev$),
  (4, 1, 'scripture', 'Today''s Reading', '1 John 4:16', $dev$“And so we know and rely on the love God has for us. God is love. Whoever lives in love lives in God, and God in them.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Every belief system needs a first stone — the one every other stone is set against — and here is yours: God loves me. Not the world in general, averaged out into a warm abstraction, but you, specifically, presently, warmly. This is the stone that determines whether the whole building leans true or crooked.

Listen to how carefully John says it. He is the disciple who leaned back against Jesus’ chest at the last supper, and he chooses two verbs to describe love: “we know and rely on the love God has for us.” Not merely acknowledge it — rely on it. Put your weight on it the way you trust a bridge without inspecting every bolt. That is the difference between knowing about God’s love and building your life on it.

Most cracked foundations crack right here. Somewhere along the way we came to believe God tolerates us rather than delights in us, monitors us rather than loves us, is perpetually a little disappointed. And once that belief is in place, every other belief bends to match it — you cannot rest, cannot receive, cannot rejoice, because the ground beneath you is unsure. Fix this stone and the whole structure steadies.

The cross is God’s once-for-all argument against your doubt: “God demonstrates his own love for us in this: While we were still sinners, Christ died for us” (Romans 5:8). Not once you cleaned up. While you were still a mess. His love was proven before you improved, which means it does not rise and fall with your performance.

So lay this stone deliberately today. Say it out loud, in the first person, until your ears finally believe your mouth: God loves me. I rely on it. Everything we build over the next eleven days will stand on this one — so set it deep.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Which counterfeit have you been believing — that God merely tolerates you, monitors you, or is disappointed in you? Where did it come from?

— What would you actually attempt this year if you truly relied on His love like a bridge?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, I lay the first stone today: You love me. Not averaged out, not reluctantly, but demonstrated at the cross while I was still far off. I do not just admit Your love — I rely on it. Let it hold my full weight.

_May the first stone settle so deep that every storm after this finds it immovable._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$1 John 4:9–19; Romans 5:6–8$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Isaiah 40:8', $dev$“The grass withers and the flowers fall, but the word of our God endures forever.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$There is one decision that will quietly change the rest of your spiritual life: deciding what gets the casting vote — your feelings or God’s Word. Until you settle it, every morning becomes a fresh election, and you re-vote your whole identity based on how you happened to wake up.

Isaiah draws the contrast we need. Grass withers, flowers fall, but the Word of our God endures forever. Your feelings are the grass — real, vivid, sometimes beautiful, and gone by Thursday. The Word is the climate that stays. Many sincere believers live spiritually seasick because they let the weather set the truth: feeling condemned, they conclude they must be condemned; feeling abandoned, they conclude God has left. But feelings are witnesses, not judges. They can honestly report your inner state without having any authority to rule on what is true.

Jesus modeled the alternative in the wilderness. Three times the enemy pressed Him, and three times He answered not with how He felt — hungry, tested, alone — but with four steady words: “It is written” (Matthew 4:4, 7, 10). He did not deny the feelings; He simply refused to let them cast the deciding vote. That is the reflex you are training.

So learn to say it, kindly but firmly: “I hear you, feeling — but it is written.” When shame says you are finished, answer with what is written. When fear says you are alone, answer with what is written. You are not lying to yourself; you are letting the more permanent truth outrank the more immediate one.

Your emotions will not disappear, and they were never meant to. But over time they will resign as rulers and take their proper seat as servants — reporting the weather while the Word sets the climate. Move the casting vote today, and keep it moved.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which recurring feeling most often out-votes the Word in your daily life?

— Find the “it is written” that directly answers that feeling. Will you memorize it today so it is ready next time?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, today I move the casting vote. My feelings may speak, but they will no longer rule — Your Word does. Teach me the reflex of Jesus in the wilderness: it is written, it is written, it is written. Settle my inner climate.

_May your inner climate grow so settled that no passing weather can rearrange it._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 40:6–8; Matthew 4:1–11$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Romans 10:17', $dev$“Consequently, faith comes from hearing the message, and the message is heard through the word about Christ.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$We often speak of faith as if it were a personality trait — some people simply have it, the way some people are naturally calm or good with numbers. But Scripture describes faith very differently. It is not a talent you were assigned at birth; it is an appetite everyone can feed. And Paul tells us its exact diet: “faith comes from hearing… the word about Christ.”

Look closely at the grammar, because it preaches. Faith comes by hearing — present tense, ongoing — not by having heard once, years ago, at a conference or a camp. It is nourished by what is reaching your ears now, this week, this season. That single detail explains something you may have puzzled over: the times your believing grew thin. Trace them honestly and you will usually find that the hearing had grown thin first. The heart follows the ears.

Belief systems, like bodies, weaken on poor diets — and here is the sobering part: no one can eat for you. Your pastor’s faith cannot feed yours. Your parents’ prayers cannot substitute for your intake. You are responsible for what you let reach your inner ear, day after day.

So build the feeding schedule deliberately. Read Scripture aloud each day — and note that your own voice speaking the Word counts as hearing it. Sit under anointed preaching through the week. Rehearse God’s past faithfulness at your own table until your children can recite the testimonies. Let worship fill the rooms of your house instead of the endless scroll of anxious news.

Fill the ears, and the heart follows. Fill the heart, and believing stops being a strain and starts becoming an overflow. You are not trying harder to have faith today; you are simply learning what to feed it.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Audit your ears honestly: what have they mostly been fed this past month, and what has that diet grown in you?

— Design your faith diet: what specifically will you hear daily, and what weekly?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, I take responsibility for the diet of my faith. Fill my ears with the word about Christ — read, preached, sung, and remembered — until believing You becomes the natural overflow of what I am hearing. I stop straining and start feeding.

_May your ears eat well this week — and your faith show the feeding._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 10:14–17; Joshua 1:8$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Hebrews 11:6', $dev$“And without faith it is impossible to please God, because anyone who comes to him must believe that he exists and that he rewards those who earnestly seek him.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Of all the things a person can bring God, why does Scripture single out faith as the one that pleases Him? Not effort, not eloquence, not even sacrifice — faith. Today’s verse quietly explains it: faith honors God’s character in a way nothing else does.

Look at what faith actually believes: that God is, and that He rewards those who earnestly seek Him. Both halves are a compliment to His nature. Faith says God is real and present, not distant or indifferent — and that He is generous, not stingy, delighting to reward the ones who pursue Him. Unbelief, by contrast, is an insult dressed up as humility. Underneath its modest tone it quietly testifies that God is either absent or tight-fisted. That is why heaven prizes trust: it tells the truth about who God is.

Now read the honor roll of Hebrews 11 and notice what it does — and does not — celebrate. It does not commemorate flawless people; every name on that list has a well-documented failure. It commemorates people who took God at His word and moved: Noah building before there was a cloud, Abraham leaving without a map, Sarah conceiving past hope, Moses choosing reproach over royalty. What earned the mention was faith that acted.

Your believing matters more than you feel it does. Every act of trust — praying again after silence, sowing again after loss, hoping again after disappointment — pleases the heart of God like few things in the universe. He notices the widow’s coin and the mustard seed.

So today, do one thing purely because you believe He rewards those who seek Him. Not because you feel certain, and not because the outcome is guaranteed — but as a deliberate act of trust laid before a God who is, and who rewards.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has “humility” quietly been hiding unbelief in your life — a place you call realistic that is really doubt?

— What one concrete act of trust will you perform today, purely to please Him?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, I want to please You — so I choose to believe the two things faith believes: You are, and You reward those who seek You. Forgive the unbelief I dressed as caution. Receive my small acts of trust today as the worship they truly are.

_May heaven smile today over your smallest act of trust._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 11:1–6; John 20:29$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '2 Corinthians 4:13', $dev$“It is written: “I believed; therefore I have spoken.” Since we have that same spirit of faith, we also believe and therefore speak.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$A belief that never reaches your mouth stays a private opinion. A belief that gets spoken becomes a governing force in your life. Paul reaches back to the Psalms to name the pattern — “I believed, therefore I have spoken” — and then says the same spirit of faith is meant to live in us: we believe, and therefore we speak. Faith has a grammar, and its verb is spoken aloud.

The whole Bible is stitched together with this thread. Abraham was renamed “father of many” and had to say it long before he saw it. David answered Goliath out loud while the army stood silent. Jesus spoke to the storm, to the fig tree, to the dead man in the tomb. Faith that stayed internal would have changed nothing; faith given a voice moved mountains.

Here is the part we underestimate: speaking does something to the one speaking, not only to the situation. Your own ears are your most faithful congregation. They attend every sermon your mouth preaches, and they never miss a service. Speak doubt and complaint over yourself all day, and you are quietly discipling yourself downward. Speak the Word over yourself, and you are discipling yourself into your own becoming.

So give your rebuilt beliefs a daily voice. Take the stones you have already laid in this plan — God loves me; His Word out-votes my feelings; He rewards those who seek Him — and read them aloud each morning before the day gets loud. Not as wishful thinking, but as agreement with what God has already said about you.

A belief system that stays silent stays fragile. A belief system with a voice grows a spine. From today, let your mouth start preaching to your ears the truth you are choosing to build on.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— What has your most faithful congregation — your own ears — been hearing from you about yourself and about God?

— Write three morning declarations from the stones you have laid in this plan. Will you begin speaking them tomorrow?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, give my believing a voice. I will speak what I believe until what I believe begins to shape what I see. Guard my mouth from discipling me downward, and teach me to preach Your Word over my own life. I believed; therefore I speak.

_May your mouth become your faith’s best friend from today._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$2 Corinthians 4:13–18; Romans 10:9–10$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'James 2:18', $dev$“But someone will say, “You have faith; I have deeds.” Show me your faith without deeds, and I will show you my faith by my deeds.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$After a voice, faith needs feet. Belief is finally proven not at the point of opinion but at the point of action. Peter’s faith in Jesus’ words was not measured by his theology of water-walking; it was measured the moment he swung his leg over the side of the boat. Until the leg moved, it was only a conversation.

James refuses to let us settle for comfortable, motionless belief. “Show me your faith without deeds,” he says — and it cannot be done, because “faith by itself, if it is not accompanied by action, is dead” (James 2:17). This is not works replacing grace; it is grace producing motion. Faith that is truly alive eventually stands up and does something.

Watch how often the miracles of Scripture ride on obedient movement. The ten lepers were cleansed “as they went,” before anything visibly changed (Luke 17:14). The Jordan parted when the priests’ feet actually stepped into the water, not before. The man with the withered hand was healed as he stretched it out — the very thing he could not do. Heaven seems to love meeting motion halfway.

So this week, convert one rebuilt belief into one scheduled action. Do you believe God provides? Then sow something you were tempted to clutch. Do you believe He has called you? Then volunteer where that calling can be exercised. Do you believe He forgives? Then have the reconciliation conversation you have been avoiding. Put it on a day, at a time.

Do not wait until you feel bold — boldness usually arrives after the first step, not before it. Act at the size of your current faith, however small, and watch your faith grow at the exact pace of your feet. Believing has feet; today, let yours move.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which belief you have rebuilt in this plan is still waiting for feet — still only an opinion?

— Schedule it now: what specific action, on what day this week, will you take to prove it?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Lord, my faith requests its walking papers. Show me this week’s one act of obedience, and I will move — the lepers were healed as they went, and I trust You to meet me in the going. I will not wait to feel bold; I will step.

_May your feet catch up with your faith — and your miracles meet you mid-stride._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$James 2:14–26; Luke 17:11–14$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Psalm 139:14', $dev$“I praise you because I am fearfully and wonderfully made; your works are wonderful, I know that full well.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Somewhere in your belief system is a file marked “my body,” and for a great many people that file is full of complaints. We stand in front of mirrors the way critics stand before an exhibit they have already decided to pan, itemizing every feature we would gladly return to the Maker for a refund. It is worth asking who taught us to read our own reflection that way.

David had every reason for insecurity — anointed but overlooked, the youngest, the shepherd left in the field when the prophet came. Yet his settled verdict about himself is startling: “I am fearfully and wonderfully made… I know that full well.” That is not fragile self-talk; it is deep-rooted conviction. He does not merely hope it might be true; he knows it fully.

The New Testament deepens the thought with a phrase easy to miss: “a body you prepared for me” (Hebrews 10:5). Your frame was not an accident of genetics; it was prepared — the height, the face, the complexion, the particular wiring of your mind — fitted to a specific assignment only you can carry. To despise it is, in a quiet way, to second-guess the God who prepared it.

Be honest about the pressure working against this belief. Whole industries are funded by your dissatisfaction; entire economies run on convincing you that you are a mistake in need of correction. Refuse the propaganda. Stewarding your body well — feeding it, resting it, keeping it strong — is wisdom. But despising it is unbelief, and it drains the very strength your assignment requires.

You cannot become your best self while at war with the vessel that carries you. Today, close the complaints file and open the praise file. Receive the body that was prepared for you, and thank the One who prepared it.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— What is honestly written in your “my body” file right now — mostly complaint, or mostly praise? Who taught you to read it that way?

— Thank God specifically for three features you have criticized. What shifts when you call them “prepared” rather than “wrong”?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Maker of my frame, I close the complaints file and open the praise file. I am fearfully and wonderfully made, and my body was prepared for the assignment You gave me. I stop despising Your work and receive it with thanks. Give me strength to steward it well.

_May you and the body that carries you finally sign a peace treaty — witnessed by its Maker._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139:13–16; 1 Corinthians 6:19–20$dev$),
  (11, 1, 'scripture', 'Today''s Reading', 'Galatians 6:4', $dev$“Each one should test their own actions. Then they can take pride in themselves alone, without comparing themselves to someone else.”$dev$),
  (11, 2, 'devotional', 'Devotional', NULL, $dev$Comparison is the termite of belief systems. It rarely announces itself; it works quietly, from the inside, hollowing out confidence until one day the structure that looked solid simply gives way. And it does its damage whether you come out ahead or behind — envy when you lose the comparison, pride when you win it, and no peace either way.

Paul names the deeper problem: those who “measure themselves by themselves and compare themselves with themselves are not wise” (2 Corinthians 10:12). The issue is not the result of the measurement but the instrument itself. Measuring your life by someone else’s life is using a broken ruler; even when it flatters you, it lies. Today’s verse offers the repair — “test their own actions,” take honest stock against your own calling, not against the person beside you.

Think about how freeing this is. You can be visibly ahead of everyone around you and still be behind your own book — falling short of the potential God assigned you, failure wearing a garland. Or you can be behind everyone around you and exactly on course in your own book — success wearing rags. Only one Judge reads your book, and He does not grade on the curve of your neighbor.

Even Peter needed this correction. When he glanced at John and asked, in effect, “What about him?” Jesus closed the audit in seven words: “What is that to you? You must follow me” (John 21:22). Not unkind — just clarifying. Peter had a lane, and John’s lane was not his business.

You have a race “marked out for us” (Hebrews 12:1) — marked out, drawn specifically for you by a Father who has no second-favorite children. Run in your lane today. Keep your eyes fixed on your own marked-out ground until comparison, starved of your attention, finally goes quiet.$dev$),
  (11, 3, 'talk', 'Talk it Over', NULL, $dev$— Whose lane have you been running your race against — and what has that comparison cost you?

— Measured honestly against your own book rather than their lane, how are you actually doing?$dev$),
  (11, 4, 'devotional', 'Pray', NULL, $dev$Father, I withdraw from every race You never entered me in. One lane, one book, one Judge — that is enough. Free me from the broken ruler of comparison, and let me test my own work and run my marked-out ground with joy. Fix my eyes forward.

_May your eyes stay so fixed on your own lane that comparison starves for attention._$dev$),
  (11, 5, 'reading', 'Go Deeper', NULL, $dev$Galatians 6:1–5; John 21:18–22$dev$),
  (12, 1, 'scripture', 'Today''s Reading', 'Romans 8:16', $dev$“The Spirit himself testifies with our spirit that we are God’s children.”$dev$),
  (12, 2, 'devotional', 'Devotional', NULL, $dev$A rebuilt belief system needs more than good arguments; it needs a Witness. You can win the debate with your doubts in daylight and still lose it at midnight, because arguments reach the mind but not always the place where fear actually lives. God knew this — which is why He placed a Witness inside you.

“The Spirit himself testifies with our spirit that we are God’s children.” That word “testifies” is courtroom language: a confirming voice, given alongside your own, verifying what is true. Beneath your changing moods, deeper than your feelings about yourself on a hard day, the Holy Spirit steadily bears witness that you belong to God. This is His work in your becoming — He takes what is objectively true and makes it inwardly unshakable.

Notice the many ways He does it. He reminds you of the Word exactly when lies come recruiting (John 14:26). He pours God’s love into your heart, not as a concept but as an experience (Romans 5:5). He is the deposit, the down payment, guaranteeing that everything God has promised you will actually be delivered (Ephesians 1:13–14). You are not holding your faith together by willpower; there is Someone holding it with you.

So involve Him by name in this reconstruction. When old beliefs wake you at midnight and start their accusations, do not try to out-argue them alone in the dark. Turn and ask: “Spirit of God, testify. Tell me again whose I am.” It is a prayer He has never once declined.

A belief you argued yourself into can be argued back out of you. But a belief confirmed by the Witness within cannot be talked out of you from without. Ask Him to testify today.$dev$),
  (12, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you been trying to argue with lies alone in the dark, or have you been calling on the Witness within?

— Where do you most need the Spirit’s inner testimony this week — about your identity, your worth, or your belonging?$dev$),
  (12, 4, 'devotional', 'Pray', NULL, $dev$Holy Spirit, Witness within me, testify to my spirit — of the Father’s love, of my place as His child, of my name written in heaven. Make the truth unshakable in the very place where arguments cannot reach. I stop debating alone and ask You to speak.

_May the Witness within you speak louder than every accusation without._$dev$),
  (12, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 8:14–17; John 14:25–27$dev$),
  (13, 1, 'scripture', 'Today''s Reading', 'John 20:27', $dev$“Then he said to Thomas, “Put your finger here; see my hands… Stop doubting and believe.”$dev$),
  (13, 2, 'devotional', 'Devotional', NULL, $dev$Thomas missed one meeting — and paid for it with a week of torment. The others had seen the risen Jesus; he had not, and he refused to pretend. “Unless I see the nail marks and put my finger where the nails were, I will not believe.” We tend to scold him for that. But notice he did not walk away from the group; he stayed close enough to be in the room the following week. His doubt was honest, and honest doubt keeps showing up.

For a full week heaven let him sit with his questions. No angel rushed to correct him, no rebuke came through the others. Then Jesus walked straight through a locked door and turned immediately to the one man who had set conditions: “Put your finger here; see my hands.” He offered Thomas the exact evidence Thomas had demanded — not a lecture, not a shaming, not a demotion from the twelve. The risen Christ made a personal appointment with one doubter’s specific terms.

And out of that tender encounter came the highest confession in all four Gospels: “My Lord and my God!” The disciple with the deepest doubt spoke the deepest worship. That is what honest doubt can become when it is brought to the right place.

Here is the difference that decides everything. Doubt handled honestly is a door: you bring it to Jesus, you state it plainly, you stay in the room with the community while you wait for Him to meet you. Doubt handled dishonestly — nursed in isolation, worn as a badge of sophistication, kept far from the people of God — slowly hardens into a wall.

Yours can be a Thomas story. A week of real questions, then a lifetime of unshakable confession. Do not leave the room. Keep your doubts, but keep them near Jesus.$dev$),
  (13, 3, 'talk', 'Talk it Over', NULL, $dev$— What are your honest “unless” conditions right now — and have you told Jesus plainly, or only muttered them in isolation?

— What keeps you “in the room” with God’s people while you wait for answers — and are you actually staying there?$dev$),
  (13, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, here are my doubts, stated plainly and honestly. I choose to stay in the room. Come through my locked doors as You came through Thomas’, meet me on Your terms, and turn my questions into worship: My Lord and my God.

_May your honest doubts receive personal appointments with the risen Christ._$dev$),
  (13, 5, 'reading', 'Go Deeper', NULL, $dev$John 20:24–29$dev$),
  (14, 1, 'scripture', 'Today''s Reading', 'Ephesians 3:20', $dev$“Now to him who is able to do immeasurably more than all we ask or imagine, according to his power that is at work within us…”$dev$),
  (14, 2, 'devotional', 'Devotional', NULL, $dev$There is a moment in every rebuilding project when inspection ends and occupancy begins — when the scaffolding comes down and someone finally moves in. After thirteen days of digging and repouring, today is that moment. It is time to put your rebuilt belief system in writing, over your own name, and move in.

Paul’s doxology gives you the confidence to sign it. God is “able to do immeasurably more than all we ask or imagine, according to his power that is at work within us.” Notice where the power operates — not out at a safe distance, but within you. You are not declaring these things by your own strength; you are declaring them in agreement with a power already at work on the inside.

So write your Declaration of Becoming, and mean every line. I declare that I am not an accident — I was chosen before the foundation of the world, and my days are written in God’s book. I declare that God loves me, and I rely on it. His Word out-votes my feelings. He rewards those who seek Him. My body was prepared for my assignment. I run in my own lane. The Witness within me confirms whose I am. I will speak these things, act on these things, and contend for everything written about me — until I become everything God created me to be.

Then do the ordinary, powerful thing: sign it and date it. Post it where your mornings will find it — the mirror, the door, the phone screen. Documents outlast moods; a declaration on the wall keeps preaching to you long after the feeling that produced it has faded.

And this document has heaven’s countersignature. You are not making these promises to yourself alone; you are agreeing with what God has already declared over you. Sign today — not because your faith is finished, but because His faithfulness never fails.$dev$),
  (14, 3, 'talk', 'Talk it Over', NULL, $dev$— Which single line of the declaration costs you the most to sign — and why does that one feel hardest?

— Where exactly will you post it so that your mornings cannot miss it?$dev$),
  (14, 4, 'devotional', 'Pray', NULL, $dev$Father, I sign this declaration — not because my faith is finished, but because Yours never fails. Countersign it with Your Spirit, put Your power to work within me, and hold me kindly to these words all my days. I move in.

_May the document you sign today still be governing your descendants’ courage._$dev$),
  (14, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 3:14–21; Habakkuk 2:2$dev$),
  (15, 1, 'scripture', 'Today''s Reading', 'Jude 20–21', $dev$“But you, dear friends, by building yourselves up in your most holy faith and praying in the Holy Spirit, keep yourselves in God’s love…”$dev$),
  (15, 2, 'devotional', 'Devotional', NULL, $dev$Fifteen days ago you inherited a foundation you did not choose. Today you own one you helped rebuild. That is worth pausing to feel. But before you close the plan, hear the commissioning hidden in Jude’s verbs, because they change everything about what happens next.

“Building yourselves up… praying in the Holy Spirit… keep yourselves.” Every verb is present and continuous. A belief system is not a monument you complete once and admire; it is a living structure that must be maintained — by hearing, speaking, acting, fellowship, and prayer in the Spirit. The moment you stop building is the moment weathering begins. What you have rebuilt in two weeks, you now keep for a lifetime.

And remember why heaven went to the trouble of rebuilding you. Foundations exist to carry weight. God does not renovate believers for museum display; He strengthens what is underneath because He intends to build something heavier on top. There are assignments ahead your old cracked slab could never have supported — the vision He will show you, the people He will send you, the battles this journey still holds. He was preparing you to bear weight.

Jesus ended His greatest sermon with a builder’s parable, and it is the right word to end on. Two houses, same storm; the difference was never the weather but the foundation. “The rain came down, the streams rose… but it did not fall, because it had its foundation on the rock” (Matthew 7:25). He did not promise the wise builder a life without rain. He promised a house that would stand through it.

Rains will come to your rebuilt house too. Let them. You have not been building on sand these fifteen days — you have been rebuilding on rock, and the rock does not move.$dev$),
  (15, 3, 'talk', 'Talk it Over', NULL, $dev$— What ongoing maintenance rhythm will keep your foundation strong — name the specific weekly practices you will keep?

— What “weight” do you sense God preparing your rebuilt foundation to carry in this next season?$dev$),
  (15, 4, 'devotional', 'Pray', NULL, $dev$Father, keep me building — hearing, speaking, acting, and praying in the Spirit — long after this plan ends. Load onto my life the weight You have been preparing me to carry. This house is on the Rock, and the Rock does not move.

_May every storm that visits your rebuilt house leave a testimony instead of damage._$dev$),
  (15, 5, 'reading', 'Go Deeper', NULL, $dev$Jude 20–25; Matthew 7:24–27$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
