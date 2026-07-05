-- Reseed the-renewed-mind with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'the-renewed-mind');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Matthew 17:2', 'The Mountain Where the Word Was Coined'),
  (2, '2 Corinthians 10:4–5', 'The Battlefield Between Your Ears'),
  (3, 'Ephesians 4:23', 'Your Mind Has a Posture'),
  (4, 'Jeremiah 17:9', 'Why Education Is Not Enough'),
  (5, 'Titus 3:5', 'The Renewer Himself'),
  (6, '2 Corinthians 3:18', 'Beholding Is Becoming'),
  (7, '2 Corinthians 3:6', 'Not a New List — a New Life'),
  (8, '2 Corinthians 10:5', 'Arrest Every Thought'),
  (9, 'Philippians 4:8', 'Replace — Don''t Just Resist'),
  (10, 'Proverbs 4:23', 'Guard the Gates'),
  (11, 'Joshua 1:8', 'Meditation: Digesting the Word'),
  (12, 'Matthew 13:31–32', 'One Thought Is All It Takes'),
  (13, 'Proverbs 23:7', 'Your Mentality Is Your Reality'),
  (14, 'Ephesians 3:20', 'Sanctified Imagination'),
  (15, 'Romans 12:2B', 'The Renewed Mind Discerns the Will of God')
) AS v(n, ref, title) WHERE p.code = 'the-renewed-mind';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'the-renewed-mind'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', 'Matthew 17:2', $dev$“There he was transfigured before them. His face shone like the sun, and his clothes became as white as the light.”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,          $dev$Before you take a single step, notice where the road begins — on a mountain, with a face that could not be looked at. Peter, James and John climbed with an ordinary Rabbi and, without warning, watched light break out from inside Him until His face shone like the sun.

Here is what makes this the perfect doorway into fifteen days on the mind. When Paul writes "be transformed by the renewing of your mind" (Romans 12:2), the Greek word he chooses is metamorphoo — the very word Matthew reaches for on this mountain when Jesus was transfigured. Same word. Same magnitude. The mind-renewal God offers is not spiritual tidying-up; it is transfiguration, glory breaking out from within.

That sets the ceiling for everything ahead, so raise your expectations to meet it. God is not proposing to give you better manners, a sunnier attitude, or a few new coping thoughts. He is proposing the family miracle — the same inward-to-outward glory that shone on the mountain, now working its slow way through your thinking. "Then the righteous will shine like the sun in the kingdom of their Father" (Matthew 13:43). What began on Christ's face is meant to finish in your mind.

So today, do only one thing: audit your expectation. Have you been asking God for adjustment when He has been offering transfiguration? Where you have quietly settled for "at least I'm coping," He is standing on the mountain, shining, saying more. Fifteen days from now you will not merely think more positively — you will be further along the road of glory.

The same Christ who shone on that mountain is Himself the light He intends to fill you with. Come and be transfigured, from the inside out.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Have you been expecting God to adjust your mind, or to transfigure it? What is the difference in what you would pray for?

— Where in your thinking do you most long for glory to break through the fog?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,          $dev$Lord Jesus, You shone on the mountain — and You offer that same transformation to me from the same root word. Lift the ceiling of what I dare to ask. Begin, this very week, to transfigure my mind from the inside out, until Your light shows in my thinking. Amen.

_May the ceiling of your expectation rise to the full height of His promise._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,          $dev$Matthew 17:1–8; Romans 12:1–2$dev$),
  (2, 1, 'scripture',  'Today''s Reading', '2 Corinthians 10:4–5', $dev$“The weapons we fight with… have divine power to demolish strongholds. We demolish arguments and every pretension that sets itself up against the knowledge of God, and we take captive every thought to make it obedient to Christ.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,          $dev$Trace any visible battle in your life back far enough and you will arrive at an invisible one — a battle that was fought and lost, or fought and won, in your thinking long before it ever showed up in your circumstances.

Paul names the enemy's fortifications with a soldier's precision: arguments, pretensions, strongholds. A stronghold is not a stray bad thought; it is a walled city of thought — an established pattern that has been reinforced so many times it now defends itself. You recognise your own strongholds by their age and their armor: the interpretations you have carried so long they no longer feel like beliefs at all, but simply like eyesight. Nothing ever works out for me. I am just what happened to me. People always leave in the end.

Now read the promise buried in the verse, because it is the reason for hope. The weapons of this warfare have divine power to demolish. Not to manage the walls. Not to decorate them or apologize for them. To demolish them. This is where so many settle for too little — they try to whitewash a stronghold when God has offered to level it. The Contractor who signed this demolition-and-construction contract has never once failed to finish a job He started (Philippians 1:6).

So today your assignment is not yet to fight — it is to survey the site. Walk the perimeter of your own mind and name your oldest stronghold, out loud, without shame. Which interpretation of your life feels less like an opinion and more like a fact of nature? Write it down. Half of a wall's power is that it has never been named; the moment you can see it as a wall — built, and therefore removable — it has already begun to lose.

Marked walls are the first to fall. Name yours, and hand the demolition to divine power.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Which thought-pattern in you is so old it no longer feels like a belief, but simply like eyesight?

— If that wall were demolished — not managed, but gone — what would a single ordinary day of your life actually look like?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,          $dev$Father, I open the whole site to You. Here are my walls — the old arguments, the pretensions, the interpretations I have defended for years. I believe Your weapons have divine power to demolish, and I stop trying to merely manage what You are able to level. Begin the demolition. Amen.

_May the oldest wall in your thinking hear its first crack today._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,          $dev$2 Corinthians 10:3–5$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Ephesians 4:23', $dev$“Be made new in the attitude of your minds.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,          $dev$Two people can hear the exact same piece of news — a delayed answer, an unexpected bill, a closed door — and one instinctively leans toward hope while the other slides toward dread. Same facts. Different fall. Why?

The answer is hidden in the wording Paul chooses. He does not say "be renewed in the thoughts of your mind" but "be renewed in the spirit of your mind" — the attitude, the posture, the bearing of it. Your mind does not merely hold views; it holds a viewpoint. It has a lean, a default direction it falls toward when nothing is holding it up. And that lean is doing quiet, constant work under everything you consciously think.

This single discovery explains years of frustration. It is why information alone has never transformed anyone. You can pour perfectly true facts into a wrongly-postured mind and watch it bend every one of them toward the old, tired conclusion — the way water poured onto a hillside always finds the old riverbed and runs there again. God is truly for you; the mind that leans toward suspicion hears even that and answers, but not really for me. The problem was never the fact. It was the tilt underneath it.

So renewal has to aim deeper than your opinions; it aims at your lean. And here is the mercy: leans can be retrained. What you deliberately behold, rehearse, and thank God for — day after unremarkable day — slowly re-grades the hillside, until the mind begins, all on its own, to fall toward hope instead of doom. You are not first changing your answers. You are changing your tilt, and the answers will follow it home.

Do not despise the slowness. A riverbed is not re-cut in an afternoon — but water, patient and daily, moves mountains.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,          $dev$— When the news is neutral and the facts are unclear, which way does your mind lean by default — toward hope or toward dread?

— Where do you think that lean was first cut into you — and what daily practice could begin to re-grade it?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,          $dev$Father, renew not only my thoughts but the tilt underneath them. I confess the direction my mind falls when nothing holds it up. Retrain the posture of my mind, patiently and daily, until hope becomes the way I naturally lean. Amen.

_May your mind learn to lean, all by itself, toward hope._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,          $dev$Ephesians 4:20–24$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Jeremiah 17:9', $dev$“The heart is deceitful above all things and beyond cure. Who can understand it?”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,          $dev$There is a comfortable belief woven through our age: that the mind's only real problem is a shortage of information. Educate people enough, the theory goes, and society will slowly heal itself. It is a hopeful idea. It is also, on the evidence, not true.

Look honestly at the record. The same education that produced healers produced eloquent con-men; the same schooling that trained statesmen trained brilliant schemers and learned deceivers. If ignorance were the whole disease, more knowledge would be the whole cure — and it plainly is not. Jeremiah's diagnosis cuts deeper and humbler: the problem with the human heart is not merely that it is uninformed, but that it is bent. "The heart is deceitful above all things." Our minds are not just finite; they are fallen.

You do not need a theologian to prove this to you — you can run the test yourself in ten seconds. Notice how little effort it takes to think about yourself: your worries, your reputation, your comfort, your grievances. Then notice how much effort it takes to fix your thoughts on God and keep them there. That gap — the effortless gravity toward self, the uphill climb toward God — is the fall, quietly measuring itself in your own mind. Left to itself, the mind resists seeing God as more worthy than its own projects.

But every honest diagnosis in the gospel is a doorway, not a dead end. What education could never reach, the Spirit can — and He is exactly who we meet tomorrow. So do not use this day for despair; use it for agreement. Stop asking mere information to do a surgeon's work. Say it plainly to the Physician: my mind needs more than data. It needs renewal.

The patient who finally names the real illness is already on the way to being healed.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Where have you quietly hoped that simply knowing more would change you — and found that it didn't?

— Run the effort test today: how easily does your mind drift to yourself, how hard is it to fix on God? What does that reveal?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,          $dev$Father, I agree with Your diagnosis. My mind needs renewal, not just more information; it is not only uninformed but bent. I stop asking data to do what only Your Spirit can. Here is the patient — heal what knowledge alone could never reach. Amen.

_May honest diagnosis open the door to deep healing this week._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,          $dev$Jeremiah 17:9–10; Romans 1:21–25$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Titus 3:5', $dev$“He saved us… through the washing of rebirth and renewal by the Holy Spirit.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,          $dev$Before we ask what your part in mind-renewal is, we have to settle whose work it is in the first place — because getting this backwards will exhaust you for years.

Here is a detail worth pausing over. The word Paul uses for "renewing" your mind in Romans 12:2 appears in only one other place in all of Scripture: right here, in Titus 3:5 — "renewal by the Holy Spirit." That is not a coincidence you can afford to miss. The renewal of the mind is, first and decisively, the Spirit's own work. Before it is ever your achievement, it is His gift.

And notice how He works — from two directions at once. From the outside in, He brings your mind under Christ-exalting truth: the Word read, preached, sung, and turned over slowly until it goes down deep. From the inside out, He softens the hardened heart that would otherwise fold its arms and reject that very truth. Both are needed. Truth pressed onto an unsoftened heart is simply refused; a softened heart with no truth to receive has nothing to lay hold of. Left to ourselves we could supply neither. He supplies both (Ezekiel 36:26–27).

Feel the relief in that, because it is meant to change how you carry this whole plan. You are not the engine of your own transformation — you are the site of it. The straining, self-improving Christian who treats renewal as a willpower project he must generate has misread the blueprint. Your part, which the coming days will patiently train, is not to be the Builder but to be the glad, cooperative building site of a Worker who has never in all of history abandoned a project He began.

So set down the crushing weight of being your own savior. Hand Him the site.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Have you been straining as the engine of your own change, or cooperating as the site of the Spirit's work? How would each one feel different this week?

— Which do you need more today — truth pressed into your mind, or softening pressed into your heart?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,          $dev$Holy Spirit, Renewer of minds, I hand You the whole project. Work from the outside in with Your truth, and from the inside out with Your tenderness. Soften what is hard, establish what is true, and teach me the glad, restful work of cooperating with You. Amen.

_May you feel the deep relief of being a building site, not the builder, today._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,          $dev$Titus 3:4–7; Ezekiel 36:26–27$dev$),
  (6, 1, 'scripture',  'Today''s Reading', '2 Corinthians 3:18', $dev$“And we all, who with unveiled faces contemplate the Lord’s glory, are being transformed into his image with ever-increasing glory, which comes from the Lord, who is the Spirit.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,          $dev$If yesterday told you the Spirit is the Renewer, today tells you His method — and it fits in a single, life-organizing sentence: transformation happens by beholding.

Watch the mechanics in the verse. As we contemplate the glory of the Lord, we "are being transformed into his image" — from one degree of glory to the next. We become what we gaze at. Beholding is becoming. And before you file that as poetry, realize it is simply a law you have already been living under your whole life, whether you named it or not. Whatever your mind beholds daily has been quietly shaping you all along — the news cycle you soak in, the feeds you scroll before sleep, the resentment you rehearse on your commute, the fears you replay until they feel like prophecy. Nobody escapes the law. The only choice any of us gets is the object of our gaze.

Which turns the whole strategy of renewal gloriously, almost embarrassingly, simple: give your gaze to Christ. Read the Gospels slowly enough to actually watch Him move — how He touches lepers, how He answers traps, how He sets His face toward the cross. Worship with your attention fully in the room, not half elsewhere. Meditate on His kindness until it warms you, His courage until it steadies you, His cross until it undoes you. A mind that beholds Jesus daily is being renovated by the very thing it keeps looking at.

So examine your gaze honestly, because it is not neutral. What has your mind been beholding most this month — and knowing this law, what is it steadily making of you? Then build one non-negotiable window into your day, a fixed appointment to look at Christ on purpose.

The change will arrive the way a sunrise does — gradually, and then all at once, unmistakably.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,          $dev$— What has your mind been beholding most this month — and, under the law of beholding, what is it quietly making of you?

— When and where will you build a fixed daily "gaze window" to behold Christ on purpose?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,          $dev$Lord, I choose the object of my gaze, and I choose You. Unveil my face before Your glory every day, and change me by what I keep watching — from one degree of glory to the next. Rescue my attention from lesser things. Amen.

_May what you behold this week begin, visibly, to become you._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,          $dev$2 Corinthians 3:12–18; Hebrews 12:1–2$dev$),
  (7, 1, 'scripture',  'Today''s Reading', '2 Corinthians 3:6', $dev$“For the letter kills, but the Spirit gives life.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,          $dev$There is a counterfeit of renewal so common it deserves a warning label — and it is subtle precisely because it looks so spiritual. It is the quiet swap of the to-do list of the flesh for the to-do list of religion.

Picture it. A man cancels every worldly behavior, tightens every external rule, becomes impressively strict — and remains completely untransformed underneath. Same heart, new regulations. The cage repainted, the bird inside unchanged. This is the danger Paul is naming: "the letter kills, but the Spirit gives life." A renewal that never gets past managed behavior is not renewal at all; it is decoration.

Watch how carefully Paul answers this. When he lists the works of the flesh in Galatians 5, he does not counter them with an opposing list of works of the law. He counters them with the fruit of the Spirit (Galatians 5:19–22). That single word — fruit — carries the whole gospel of the mind. Works are manufactured; fruit is grown. Lists press change onto you from the outside, demanding and exhausting; life pushes change up through you from the inside, organic and unforced. God is not running a behavior-management program on you. He is doing something far more dignified — a real change of nature, from the inside out.

So measure your progress on the right meter, or you will either despair or grow proud on false readings. The renewal question is not merely "what did I successfully avoid this week?" — a question the coldest legalist can pass. The deeper question is "what is actually growing in me?" Is there more love than there was a season ago? More joy that does not depend on circumstances? More peace under pressure? An orchard cannot be faked into existence by willpower; it can only be grown by life.

Stop repainting the cage. Ask the Spirit for fruit — and then watch the orchard, because the orchard never lies.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Where has your walk with God quietly become list-keeping — managed behavior — rather than fruit-growing?

— Which fruit of the Spirit is visibly larger in you this season than a year ago? Which one is only just budding?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,          $dev$Father, save me from the repainted cage and the killing letter. I do not want managed behavior; I want a changed nature. Grow Your fruit in me from the inside out — real love, real joy, real peace — until my life is the evidence of Your life. Amen.

_May something sweet and unmistakable grow in your orchard this month._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,          $dev$Galatians 5:16–25; 2 Corinthians 3:4–6$dev$),
  (8, 1, 'scripture',  'Today''s Reading', '2 Corinthians 10:5', $dev$“…we take captive every thought to make it obedient to Christ.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,          $dev$For seven days we have watched the Spirit do His work. Today your part of the work begins in earnest — and it opens, strangely enough, with an arrest warrant.

"Take captive every thought." The picture Paul paints is unmistakably military: a checkpoint at the border of your mind, a guard post where thoughts are stopped, questioned, and processed before they are ever allowed to settle inside and set up residence. The trouble is that most thoughts sail straight through unexamined. They arrive dressed in your own voice, claiming full citizenship — and so you assume they belong to you. But many are foreigners: whispered suggestions of the enemy, echoes bouncing up from old wounds, passing moods that have learned to masquerade as settled facts. Waved through without inspection, they take up quarters and start giving orders.

The renewal discipline, then, is to audit the traffic. This week, pay deliberate attention to your recurring thoughts — the ones that circle back again and again. Write them down if you have to; a thought is far easier to examine on paper than while it is running loose. Because here is the rule: a thought must first be arrested before it can be tried. You cannot cross-examine what you have never stopped.

Then try each captured thought against one simple standard — does this agree with what God says? If it does, grant it residence; let it stay and shape you. If it does not, no matter how familiar its face or how long it has lived in you, escort it firmly to the border in the name of Jesus. It has no right to a home in a mind that belongs to Christ.

You were never meant to be the helpless audience of your own mind, wincing at whatever plays across it. In Christ, you are its gatekeeper. Start manning the gate today.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,          $dev$— What recurring thought has been living in you unexamined, claiming to be your own voice — when it may be a foreigner?

— Arrest one today: write it down, try it against the Word, and record your verdict. Residence, or deportation?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,          $dev$Lord, I set up the checkpoint at the border of my mind. From now on, every thought must show its papers. Give me alertness to arrest what slips through, wisdom to try it against Your Word, and the authority You have granted me to deport what does not belong — in Jesus' name. Amen.

_May your border posts stay manned and your inner city stay at peace._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,          $dev$2 Corinthians 10:5; Psalm 19:14$dev$),
  (9, 1, 'scripture',  'Today''s Reading', 'Philippians 4:8', $dev$“Finally, brothers and sisters, whatever is true, whatever is noble, whatever is right, whatever is pure, whatever is lovely, whatever is admirable — if anything is excellent or praiseworthy — think about such things.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,          $dev$Yesterday you learned to arrest wrong thoughts. Today you learn why arresting them is only half the battle — and why sheer resistance, on its own, keeps failing you.

Jesus told of a house swept clean and left empty. The evicted spirit wandered, found no rest, and returned to find its old home "swept clean and put in order" — vacant. So it moved back in with seven others worse than itself, and the final state of that house was worse than the first (Matthew 12:43–45). Read it as a parable of the mind and it will explain a hundred failed attempts: emptiness is not victory. A swept-but-empty room is not a defeated temptation; it is a vacancy notice, and something is always waiting to answer it.

This is why the Bible's method is never mere resistance — it is substitution. Every time a wrong thought is evicted, a right one must be installed in the room it left behind. Call it the Law of Substitution, and then notice that Philippians 4:8 is simply the furniture catalogue: whatever is true, noble, right, pure, lovely, admirable — think on these things. God does not just tell you to stop thinking wrongly; He hands you the exact inventory of what to move in instead.

The practical genius of this is that it can be prepared in advance. Do not wait until you are under attack to go looking for a replacement — you will lose that scramble. Take the recurring lie you arrested yesterday and, today, write out its scriptural replacement word for word, then keep it somewhere within arm's reach: a card, a note, a lock screen. When the lie knocks, you will not be caught with an empty room; you will already be furnishing a better one.

Because the fastest way out of a wrong thought was never to wrestle it in its own room. It is to get up and walk into a better one.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Which thought have you successfully arrested, yet left an empty room behind — so it keeps coming back?

— Write out, word for word, the Philippians 4:8 truth you will install in that room today. Where will you keep it within reach?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,          $dev$Father, I refuse to leave swept rooms standing empty for the enemy to reclaim. Fill every vacancy in my mind with what is true, noble, pure and lovely. Teach me to prepare my replacements in advance, and to change rooms quickly. Amen.

_May every evicted lie return to find its room already occupied by truth._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,          $dev$Philippians 4:8–9; Matthew 12:43–45$dev$),
  (10, 1, 'scripture',  'Today''s Reading', 'Proverbs 4:23', $dev$“Above all else, guard your heart, for everything you do flows from it.”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,          $dev$Whatever you keep feeding your mind is quietly farming your mind. That single sentence, taken seriously, will reorganize your whole day.

Your eyes and ears are gates, and everything that passes through them is not merely passing through — it is planting. The news you soak in, the music that loops until you hum it without thinking, the conversations you sit inside, the accounts you scroll at midnight when your defenses are lowest — none of it is neutral traffic. It is seed going into soil. And here is the uncomfortable insight hidden underneath so much of what we call weak willpower: much of it is really carelessness at the gates. We lose the battle quietly at intake, then stand baffled when we lose it loudly at output, never connecting the harvest to the planting.

Solomon does not say guard your heart as one item on a list; he says "above all else." Above your career strategy, above your five-year plan, above the thousand things clamoring for first place — guard the source, because "everything you do flows from it." What you focus on multiplies. Which means your inputs are not entertainment; they are agriculture, and you are always harvesting last season's planting.

So this week, take an honest gate inventory — without condemnation, but also without mercy. Sit down and actually ask: what enters my eyes and ears on a normal day, and what is each thing planting in me? Then farm on purpose. Unfollow the account that reliably grows anxiety. Mute the feed that farms comparison. Add the voice that plants faith. Subscribe to what you would gladly harvest. You are not being asked to become a hermit; you are being asked to become a farmer of your own attention.

Guard the gates, and you guard the harvest — which turns out to be everything else you have been trying to fix.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Of your three gates — eyes, ears, and company — which one is currently the least guarded?

— Name one input you will remove this week and one you will deliberately plant. What harvest are you sowing toward?$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,          $dev$Father, I station watchmen at my gates. Give me the honesty to see what I have been planting and the courage to farm on purpose. Let what enters my eyes and ears this week be only seed I would gladly harvest. Amen.

_May your gates admit only what your future will thank you for._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,          $dev$Proverbs 4:20–27; Psalm 101:2–3$dev$),
  (11, 1, 'scripture',  'Today''s Reading', 'Joshua 1:8', $dev$“Keep this Book of the Law always on your lips; meditate on it day and night… Then you will be prosperous and successful.”$dev$),
  (11, 2, 'devotional', 'Devotional',       NULL,          $dev$Two people read the same chapter this morning. One closed the book and forgot it before breakfast was over; the other carried a single verse through the whole day like a sweet turned slowly in the mouth — and was changed by it. The difference was not intelligence or spirituality. It was the difference between reading and meditation.

Reading passes the food across the plate; meditation is what actually gets it into the bloodstream. This is why information about the Bible transforms so few people — the truth is real, but it never leaves the plate. And notice what God attached Joshua's whole success to. Not his talent, not his connections, not his pedigree, but a meditation habit: "meditate on it day and night… then you will be prosperous and successful." The promise is fastened directly to the practice.

It helps enormously to clear up what biblical meditation actually is, because our age hears the word and thinks of emptying the mind. Scripture means the opposite — it means filling the mind. You take a single verse and you turn it over; you question it, you speak it aloud, you press it for its meaning, you picture yourself actually obeying it, and you keep at it until the truth stops being mere information and becomes nourishment you can feel. Truth may not yet free you while it is still only understood; it frees you as it is received deeply and arranged inwardly, one truth settling on top of another until they hold weight.

So try it this week, deliberately. Take one verse each morning — just one. Read it, then think it. Read it again, then ponder it. Squeeze it the way you would squeeze the juice from an orange, patiently, until the flavor is gone into you, and then carry that one verse with you clear through to nightfall.

Stop merely tasting the Word and skating on. Learn, this week, to digest it.$dev$),
  (11, 3, 'talk',       'Talk it Over',     NULL,          $dev$— What is the actual difference in you between a week you merely read the Bible and a week you truly meditate on it?

— Which single verse will you take as today's "sweet in the mouth" and carry from morning until night?$dev$),
  (11, 4, 'devotional', 'Pray',             NULL,          $dev$God of Joshua, teach me to digest Your Word and not just taste it. One verse at a time, day and night, let Your truth pass out of my understanding and into my bloodstream, until it changes the very chemistry of my life. Amen.

_May today's verse still be sweet on your tongue at midnight._$dev$),
  (11, 5, 'reading',    'Go Deeper',        NULL,          $dev$Joshua 1:6–9; Psalm 1:1–3$dev$),
  (12, 1, 'scripture',  'Today''s Reading', 'Matthew 13:31–32', $dev$“The kingdom of heaven is like a mustard seed, which a man took and planted in his field. Though it is the smallest of all seeds, yet when it grows, it is the largest of garden plants.”$dev$),
  (12, 2, 'devotional', 'Devotional',       NULL,          $dev$Never despise the size of a single thought. It looks like nothing — a stray impression, a quiet idea in the middle of prayer — and yet one thought, planted and watered and obeyed, can reorganize an entire life and outlast a generation.

Scripture is a gallery of these small beginnings. Abraham received a single thought under a night sky — "so shall your offspring be" — and that one sentence carried him through twenty-five childless years until it came true. Moses turned aside to look at one burning bush, and the thought he carried away from it eventually emptied Egypt of an entire nation. Jesus tells us the kingdom of heaven itself runs on this mathematics: it starts as the smallest of all seeds and becomes the largest of garden plants. Every reformation, every ministry, every rebuilt family, every enterprise you admire began the same way — as one idea in one mind that simply refused to let it die.

This also explains something you may have felt but never named: why the enemy contests your thoughts so early and so fiercely. He fights seeds because he fears forests. He knows that a single God-given thought, if it is allowed to take root, becomes a tree he can no longer cut down — so he attacks it while it is still small and deniable, whispering that it is unrealistic, that it is just you, that it will come to nothing.

Which means you should handle your holy impressions with far more reverence than you probably do. Somewhere in your recent praying and reading, God may already have dropped the seed-thought your next decade is meant to grow from — and you may have let it roll away as too small to matter. So this week, guard the seeds. When an impression from Him comes, write it down before it evaporates. Water it in prayer. And do the one thing that separates dreamers from builders: act on its first small obedience.

Handle the mustard seed with reverence. Forests are hidden inside it.$dev$),
  (12, 3, 'talk',       'Talk it Over',     NULL,          $dev$— What God-planted thought have you been carrying lightly, as too small to matter — that may deserve real reverence?

— What is the first small act of obedience that would begin to water it this week?$dev$),
  (12, 4, 'devotional', 'Pray',             NULL,          $dev$Father, make me a careful farmer of holy thoughts. Forgive me for letting Your seeds roll away as too small. The thought You have planted in me — I will write it down, water it in prayer, and walk out its first obedience, until it towers into shade. Amen.

_May one mustard seed of a thought grow into shade for many who come after you._$dev$),
  (12, 5, 'reading',    'Go Deeper',        NULL,          $dev$Matthew 13:31–33; Genesis 15:5–6; Habakkuk 2:2$dev$),
  (13, 1, 'scripture',  'Today''s Reading', 'Proverbs 23:7', $dev$“For as he thinketh in his heart, so is he.”$dev$),
  (13, 2, 'devotional', 'Devotional',       NULL,          $dev$Twelve men walked the same land. They toured the same hills, tasted the same enormous grapes, measured the same intimidating giants. Twelve saw identical facts — and came back with two completely different realities, because they came back with two different minds.

Ten of them reported: "We seemed like grasshoppers in our own eyes, and we looked the same to them." Two of them, Caleb and Joshua, reported: "We can certainly do it." Same giants, same walls, same evidence — but each group received exactly the reality its mind had already chosen. The grasshopper generation wandered and died within reach of the very promise they had been given; the two men with the other mentality walked in and possessed it. Now catch the terrible sequence buried in the majority's own words: "grasshoppers in our own eyes" comes first, and "so we looked to them" comes second. The inner measurement came before the outer defeat. The world largely takes you at the valuation you have already placed on yourself.

Here is the sentence to underline and carry: your mentality is your reality. What you sincerely think of yourself in the hidden place quietly writes the ceiling of what you will attempt, endure, and receive. But mark the good news too — mentalities are not fate. They are not fixed features of your soul; they are habits of thought, and habits, as these fifteen days have been proving to you, can be rebuilt.

So find the arena where you have been sizing yourself as a grasshopper — in the room, in the marketplace, in the calling, in the family. Then hear this: heaven has filed a completely different measurement of you in that exact place. Your task is simply to adopt heaven's arithmetic over your own. Stop asking "how big is the giant?" and start asking the only question that ever mattered: how big is my God?$dev$),
  (13, 3, 'talk',       'Talk it Over',     NULL,          $dev$— In which specific arena — a room, a market, a calling — do you still quietly measure yourself as a grasshopper?

— What is heaven's measurement of you in that same arena? Say it out loud in God's arithmetic.$dev$),
  (13, 4, 'devotional', 'Pray',             NULL,          $dev$Father, I resign, today, from the grasshopper mentality. Give me the spirit of Caleb — a different spirit — that follows You fully and measures every giant against You rather than measuring You against the giant. Rewrite my inner valuation to match Yours. Amen.

_May you enter, in your lifetime, every promise the grasshopper mind would have forfeited._$dev$),
  (13, 5, 'reading',    'Go Deeper',        NULL,          $dev$Numbers 13:26–14:9; Proverbs 23:7$dev$),
  (14, 1, 'scripture',  'Today''s Reading', 'Ephesians 3:20', $dev$“Now to him who is able to do immeasurably more than all we ask or imagine, according to his power that is at work within us…”$dev$),
  (14, 2, 'devotional', 'Devotional',       NULL,          $dev$God built into the human being a power so great that at Babel heaven itself paused to comment on it: "nothing they plan to do will be impossible for them" (Genesis 11:6). What was that power heaven took so seriously? It was imagination — the mind's astonishing ability to travel into what does not yet exist, walk around inside it, survey it in detail, and come back to build it into the world.

Look around wherever you are sitting. Every made thing near you took that same journey: it was first a picture in someone's mind and only afterward a thing in the world. The building, the chair, the device in your hand — each was imagined before it was ever engineered. Imagination is the drafting room where the future is drawn. And like every real power, it is morally neutral; it faithfully serves whoever employs it. Fear knows this well and hires your imagination constantly — running vivid, high-definition films of futures that God never wrote, disasters that never arrive, conversations that never happen. Faith wants to hire the very same faculty for the opposite work: to see what God has actually promised before it shows up. This is exactly what God had Abraham do — took him outside, said "count the stars," and let him see his descendants before he had a single child.

So do not do what frightened, disappointed people so often do — amputate the imagination as though it were the problem. The imagination is not the enemy; an unsanctified imagination is. Do not kill it; consecrate it. Dare to dream again. Let Scripture, and not dread, supply the pictures your mind runs. Deliberately imagine yourself obeying, serving, growing, becoming the person God has spoken of.

And then read today's verse one more time, because it does something wonderful to every picture you dare to hold: He is able to do immeasurably more than all you ask or imagine. Your boldest, most sanctified imagination of your future is still, gloriously, an underestimate.$dev$),
  (14, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Has your imagination been on hire to fear or to faith lately? What films has it been running?

— What God-aligned picture of your future will you deliberately, repeatedly hold before your mind this week?$dev$),
  (14, 4, 'devotional', 'Pray',             NULL,          $dev$Father, I take my imagination back from fear and I hire it out to faith. Sanctify this power You gave me. Fill it with pictures worthy of Your promises — and then, as You have said, exceed even those. Amen.

_May your redeemed imagination out-dream your history — and still fall short of what He does._$dev$),
  (14, 5, 'reading',    'Go Deeper',        NULL,          $dev$Ephesians 3:14–21; Genesis 15:5$dev$),
  (15, 1, 'scripture',  'Today''s Reading', 'Romans 12:2B', $dev$“Then you will be able to test and approve what God’s will is — his good, pleasing and perfect will.”$dev$),
  (15, 2, 'devotional', 'Devotional',       NULL,          $dev$We end exactly where Romans 12:2 ends — at its purpose clause, the "then." Why does God go to all the trouble of renewing a mind? The verse answers plainly: "then you will be able to test and approve what God's will is." Renewal was never the destination; discernment was.

Here is the harvest of your fifteen days, stated as a promise. A renewed mind becomes an instrument of discernment — it begins to recognize the will of God the way a trained ear recognizes true pitch, almost instinctively, before it can fully explain why. This is enormously practical, and you should expect to feel it. Decisions start to change. Guidance stops feeling like anxious guessing in the dark, because a mind that has been soaked long enough in the Word begins, quietly, to think in the grain of the Author. You start reaching for what pleases God not by grinding through rules but by a renewed instinct that has learned His heart. Confusion loses much of its old grip precisely where renewal has done its patient work.

So do not let the workshop close when this plan does. Take its tools with you and keep using them. Behold Christ daily; man the checkpoint at the border of your mind; substitute truth for every evicted lie; guard your gates; meditate until the Word is in your bloodstream; reverence the holy thoughts God plants; refuse every grasshopper measurement; and dream again with a sanctified imagination. These are not fifteen days of exercises to be filed away — they are lifelong disciplines to be carried.

Because when a mind is transformed to a new level, the person is ushered into a new level of life. This was never merely about thinking better; it was about becoming. So keep the disciplines, and let God keep the transformation. Keep ascending — from glory to glory to glory.$dev$),
  (15, 3, 'talk',       'Talk it Over',     NULL,          $dev$— Which three of the workshop disciplines will you commit to keeping permanently, long after this plan ends?

— What decision currently in front of you looks different when you view it through a renewed, discerning mind?$dev$),
  (15, 4, 'devotional', 'Pray',             NULL,          $dev$Father, finish what You have begun in me — a mind so renewed that it recognizes Your good and perfect will on sight. I will keep the disciplines You have taught me; You keep the transformation You have started. Carry me on, from glory to glory. Amen.

_May the will of God become the easiest thing in the world for your renewed mind to recognize._$dev$),
  (15, 5, 'reading',    'Go Deeper',        NULL,          $dev$Romans 12:1–2; Colossians 3:1–2$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
