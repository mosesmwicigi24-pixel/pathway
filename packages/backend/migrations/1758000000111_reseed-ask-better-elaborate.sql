-- Reseed ask-better with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'ask-better');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Matthew 16:15–16', 'The Teacher Who Asked'),
  (2, 'Matthew 7:7', 'Questions Are Seeds'),
  (3, 'Romans 12:2', 'Retire the Defeated Questions'),
  (4, 'Genesis 3:9', 'The God Who Asks "Where Are You?"'),
  (5, 'Proverbs 20:5', 'Go Deeper Than the First Answer'),
  (6, '1 Samuel 17:26', 'Question Your Assumptions'),
  (7, 'James 1:5', 'Ask for Wisdom — He Gives Generously'),
  (8, 'Psalm 25:4', 'The Six Questions of Destiny'),
  (9, 'Luke 11:8', 'Keep Knocking'),
  (10, 'Psalm 139:23–24', 'Search Me — the Prayer of the Open Life')
) AS v(n, ref, title) WHERE p.code = 'ask-better';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'ask-better'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', 'Matthew 16:15–16', $dev$“But what about you?” he asked. “Who do you say I am?” Simon Peter answered, “You are the Messiah, the Son of the living God.”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,     $dev$Notice what Jesus does not do. Standing with His disciples at Caesarea Philippi, He does not deliver a lecture, hand out a creed, or announce His résumé. He asks a question — and then a sharper one. The Master Teacher opens the most important conversation of their lives by making them answer.

He begins gently: "Who do people say the Son of Man is?" That one is easy; it only requires reporting rumors. Then He turns the blade inward: "But what about you? Who do you say I am?" The crowd's opinion is now off the table. Borrowed answers will not do. And into that silence Peter says the sentence that changes everything: "You are the Messiah, the Son of the living God."

Watch the sequence, because heaven still moves in this order: question, then confession, then revelation, then keys. Peter's answer did not come from cleverness — "this was not revealed to you by flesh and blood, but by my Father in heaven" (Matthew 16:17). His confession unlocked a blessing and a destiny in the same breath: the rock, the church, the keys of the kingdom. The question opened the gate; the revelation walked in behind it.

This is why the whole plan begins here. Every other question you will ever ask — about your work, your fear, your future — stands on the answer you give to this one. A life built on a borrowed Jesus wobbles; a life built on a confessed Jesus holds. So do not rush past it today. Let His question sit on you, unhurried, until the answer is genuinely yours and not merely inherited.

Who do you say He is? Answer that, and you have found the ground everything else can be built on.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Who do you say Jesus is — in your own unborrowed words, not a phrase you were handed?

— How does your answer to that question quietly shape every other question you ask of life?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, You are the Messiah, the Son of the living God — my answer and my Answerer. I confess You today not from habit but from the heart. Teach me this week to ask the way You taught, questions that open gates rather than close them. Amen.

_May the greatest question ever asked find its firmest answer in you._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,     $dev$Matthew 16:13–20$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Matthew 7:7', $dev$“Ask and it will be given to you; seek and you will find; knock and the door will be opened to you.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,     $dev$Listen to the questions running under your thoughts like a soundtrack you have stopped noticing. They are shaping you more than you know. Show me a person's habitual questions and I will show you the direction of their life.

Jesus stacks three verbs today — ask, seek, knock — and each begins with a question turned toward heaven. But there is a quieter law hidden here that governs even the questions we never pray. A question is a seed. Plant it, and something inside you begins arranging a harvest to match it. Ask "how can I grow from this?" and your mind goes hunting for growth, gathering lessons like a farmer gathering grain. Ask "why does this always happen to me?" and that same mind — obedient, tireless — will faithfully collect the evidence of doom you requested.

Scripture said it first and deepest: "Above all else, guard your heart, for everything you do flows from it" (Proverbs 4:23). The questions you keep asking are seeds already in that soil. Some are seeds of life; some are seeds of a cage you built yourself. And Jesus' promise cuts both ways — ask, and it will be given. The soil does not argue; it simply produces what is planted.

So take an audit today, gently and honestly. What are the three questions you ask yourself most? Are they opening doors or bricking them shut? Here is the good news that carries this whole plan: seeds can be exchanged. You are not stuck with last year's planting. A new question, sown this very week, begins a new harvest.

The direction of your life follows the direction of your questions — so choose your seeds with care.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What three questions do you ask yourself most often? Write them down honestly, without editing them to sound better.

— What harvest are those questions currently arranging in your life?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,     $dev$Father, You have shown me that my questions are seeds, and that You answer the one who asks, seeks, and knocks. Walk with me through my inner soil this week — help me uproot what I never meant to plant, and sow questions worth harvesting. Amen.

_May every seed you plant with your questions grow into a harvest worth eating._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,     $dev$Matthew 7:7–11; Proverbs 4:23$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Romans 12:2', $dev$“Do not conform to the pattern of this world, but be transformed by the renewing of your mind.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,     $dev$Some questions are not really questions at all. They are accusations wearing the clothes of questions. Why can't I ever succeed? Why am I so unlucky? Why am I the only one facing such battles? They arrive dressed as honest inquiry, but the verdict is already sealed inside them.

Paul warns against being "conformed to the pattern of this world" — and one of the world's oldest patterns is the self-defeating question that keeps a person walking the same road every year and calling it fate. These are what I call circular circles of no change: the question assumes defeat, the answer obediently confirms the defeat, and the man ends where he began, only more convinced. He is not being conformed by the world outside so much as by the interrogation inside.

But notice the door Paul leaves open — "be transformed by the renewing of your mind." Transformation is not squeezing harder within the old pattern; it is renewing the very questions the mind is allowed to ask. And renewal begins with an honest dismissal. Before you can hire better questions, you must retire the ones that have only ever ruled against you.

So hold a retirement ceremony today, out loud if you can. Name your defeated questions by name — the one that whispers you always fail, the one that insists it is too late, the one that decided long ago that people like you don't get to win. Thank them for nothing, and dismiss them from service. They have worked in your life long enough, and the wages they paid were despair.

Tomorrow we will hire their replacements. Today, simply and firmly, let them go.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Which defeated question has served longest in your inner life — the one so familiar you stopped noticing it was cruel?

— What has it cost you across the years, in hope, in courage, in attempts you never made?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,     $dev$Father, today I refuse to be conformed to the pattern of my old questions. I retire the ones that always ruled against me, and I dismiss them in Jesus' name. Renew my mind, and prepare my heart to hire the questions of life. Amen.

_May the old interrogators of your soul be found unemployed from today._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,     $dev$Romans 12:1–2; Philippians 4:8$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Genesis 3:9', $dev$“But the Lord God called to the man, “Where are you?”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,     $dev$The first question in the Bible is not asked by a person to God. It is asked by God to a person — and everything depends on hearing its tone rightly.

Adam and Eve have eaten, hidden, and sewn their fig leaves. Then the Lord God walks in the garden and calls, "Where are you?" Now, the all-knowing God did not misplace His man. He was not requesting coordinates. This is a father's question, the kind a parent asks not to gather information but to draw a hiding child out of the bushes and back into honest relationship. God's questions locate; they do not humiliate.

He asks this way all through Scripture. To Elijah, collapsed under the broom tree: "What are you doing here?" To blind Bartimaeus: "What do you want me to do for you?" To Peter beside the charcoal fire, three tender times: "Do you love me?" Every one of them is an open door dressed as an inquiry — an invitation to come out, own where you are, and be restored. The God who searches is the God who saves.

He may be asking you one of His questions right now, in this season, through a stirring you have been avoiding. The whole difference is in how you answer. Adam answered with hiding and blame: the woman You gave me. That road leads nowhere but deeper into the bushes. There is a better answer, and it is the oldest posture of faith — "Here I am." No fig leaves, no excuses, no shifting the fault. Just honest location.

Do not answer God the way Adam did. Answer Him in the open, and discover that His question was mercy all along. Honest location is where every restoration begins.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,     $dev$— If God asked you "Where are you?" today — honestly, no fig leaves — what would the true answer be?

— What question does He seem to be asking you in this season, that you have been avoiding answering?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,     $dev$Father, here I am — no bushes, no blame, no borrowed excuses. Ask me Your questions, and give me the honesty to answer from exactly where I truly stand. I trust that Your searching is Your mercy. Amen.

_May you step out of every bush and find that His voice was mercy all along._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,     $dev$Genesis 3:8–13; 1 Kings 19:9–13; John 21:15–17$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Proverbs 20:5', $dev$“The purposes of a person’s heart are deep waters, but one who has insight draws them out.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,     $dev$Most people, when they finally sit down to question their own lives, stop drilling one layer too soon. They reach the answer that flatters them and put the bucket down — because the next answer, the true one, usually costs something the first one does not.

Solomon says the heart's purposes are "deep waters," and that it takes insight to "draw them out." Deep waters do not surrender their treasure to a shallow bucket. Watch how the depth increases with each honest question. Ask "what happened?" and you get a story — usually with you as the wronged party. Ask "why did it happen?" and you begin to see a pattern, a shape that has repeated before. Ask "what was my part in it?" and suddenly you are holding a mirror. Ask "what must I become so that it does not happen again?" and at last you have found a door.

Most people live at the level of the story. They can tell you exactly who did them wrong, in vivid detail, ten years running. The becoming ones keep drilling past the story, past the blame, down to the part that only they can change. It is uncomfortable — the best questions almost always lead to uncomfortable truths — but that discomfort is not your enemy. It is the labor ward of growth.

So take one recurring frustration in your life today and refuse to stop at the first answer. Ask the second question, then the third, then the honest one you have been avoiding. Draw the deep water up into the light where it can finally be dealt with.

The treasure was never floating on the surface. Draw deep this week, and bring up what has been quietly steering you from below.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Where did you recently stop at the first, flattering answer because the second one would have cost you something?

— Take one recurring frustration in your life: what is your honest part in it?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,     $dev$Father, give me a deeper bucket and the insight to use it. I choose the uncomfortable second answer over the comfortable first one. Draw out of me what I have avoided knowing, and give me courage to face it. Amen.

_May the deep waters of your heart yield treasure to your drawing this week._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,     $dev$Proverbs 20:5; Psalm 51:6; Haggai 1:5–7$dev$),
  (6, 1, 'scripture',  'Today''s Reading', '1 Samuel 17:26', $dev$“David asked the men standing near him, “…Who is this uncircumcised Philistine that he should defy the armies of the living God?”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,     $dev$For forty days an entire army lived under one assumption nobody had ever voted on: Goliath cannot be beaten. No general announced it. It had simply settled over the valley like weather, and Israel woke up under it every morning and trembled.

Then a shepherd boy arrived with lunch for his brothers and asked a completely different question. Not "how big is he?" — everyone already knew that answer, and it had frozen them for six weeks. David asked, "Who is this uncircumcised Philistine that he should defy the armies of the living God?" One question, and the whole battle was reframed. The giant did not shrink an inch. But the assumption cracked. Suddenly this was not an unbeatable champion; it was one man insulting the living God — and that is a very different problem.

Here is the quiet tyranny of assumptions: many of our prisons have unlocked doors. The bars are not facts; they are beliefs we have simply never put on trial. There is only one option. People like me don't get to succeed. It's too late for this dream now. We do not test these sentences; we obey them, the way Israel obeyed the weather.

But you can put an assumption on trial the way David did — by asking it for its evidence. Take your oldest "everyone knows" today, the one that has been quietly governing your decisions, and interrogate it out loud. Where did it come from? Who told you? Is it actually true, or merely old?

You may discover, as Israel did, that the thing which silenced you for forty days falls to a single well-aimed question.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What "everyone knows" assumption has been quietly governing your decisions, unexamined, for years?

— What question would David ask about your Goliath, the thing that has silenced you longest?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,     $dev$God of David, teach me to question the weather of assumptions instead of just living under it. Where a lie has ruled unexamined in my mind, give me the one brave question that brings it down. Amen.

_May one brave question topple what forty days of fear could not._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,     $dev$1 Samuel 17:20–37; Numbers 13:30–33$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'James 1:5', $dev$“If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,     $dev$Read today's verse slowly, because it is so generous we almost refuse to believe it. God answers wisdom-requests "without finding fault." He does not sigh, "You should know this by now." He does not first review your record of past mistakes. He simply gives — generously, to all who ask.

This has always been how heaven treats a good question. Solomon stood at the same open door. God offered him anything — anything — and instead of long life or riches or the death of his enemies, he asked for "a discerning heart to govern your people and to distinguish between right and wrong" (1 Kings 3:9). God was so delighted with the question that He gave Solomon what he asked and then poured in everything he had not asked for: riches, honor, unmatched wisdom. Heaven rewards good asking.

Which uncovers a painful truth James states plainly elsewhere: "You do not have because you do not ask God" (James 4:2). How much of what we lack is not withheld but simply unrequested? We carry decisions for weeks, worrying them smooth like a stone in the pocket, when two honest words would have opened heaven: "Father, wisdom."

So make asking a discipline this week, not a last resort. Before the meeting, before the difficult conversation, before the decision you have been dreading — stop and ask. "Father, wisdom." It takes three seconds. And those three seconds, prayed in real faith, have redirected more lives than a thousand hours of anxious worry ever have.

You lack wisdom, and He loves to give it. Stop worrying about the decision and start asking about it.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What decision are you carrying right now that you have worried about far more than you have actually asked God about?

— What would "asking first" look like as a daily habit, not an emergency measure?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I lack wisdom and You love to give it, generously and without finding fault. For every decision on my desk this week — wisdom. I ask in faith, expecting the generous answer You have promised. Amen.

_May generous wisdom arrive ahead of every decision you face this week._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,     $dev$James 1:2–8; 1 Kings 3:5–14$dev$),
  (8, 1, 'scripture',  'Today''s Reading', 'Psalm 25:4', $dev$“Show me your ways, Lord, teach me your paths.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,     $dev$There are six questions a person of purpose should return to again and again, like a traveler checking a compass. Miss them, and you can be busy for decades without ever being on your way.

David models the posture that opens them: "Show me your ways, Lord, teach me your paths." He is not demanding; he is inquiring. And the great inquiries of a purposeful life fall into six. Who am I? — the question of identity. Where did I come from? — the question of origin. Why am I here? — the question of purpose. What can I do? — the question of potential. Where am I going? — the question of destiny. What should I become? — the question of growth. These six hold a life together.

Here is the beautiful part: these are not questions you answer once and file away. They are companions you walk with, and their answers deepen every season you return to them. The "why am I here" you answer at twenty-five is true; the one you answer at forty-five, after loss and mercy and a few surrendered dreams, is truer and richer. The examined life is not a one-time exam. It is a lifelong conversation.

And notice something quietly wonderful — this entire journey of study plans has been built on these six questions. You have already sat with identity and origin. You are sitting with purpose right now. Potential and destiny still lie ahead of you. You have been answering these questions without always knowing their names.

The examined life is not a philosopher's luxury reserved for the leisured. It is a disciple's ordinary habit. Show me Your ways, Lord — and teach me to keep asking.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Which of the six great questions have you never seriously sat with — identity, origin, purpose, potential, destiny, or growth?

— Schedule it: when, this week, will you give that one question an unhurried hour?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,     $dev$Lord, I take up the six great questions as lifelong companions rather than one-time exams. Show me Your ways, teach me Your paths, and answer me a little more deeply in every season I return to ask. Amen.

_May the six great questions become six old friends who always lead you home._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,     $dev$Psalm 25:4–5, 12–14$dev$),
  (9, 1, 'scripture',  'Today''s Reading', 'Luke 11:8', $dev$“Because of your shameless audacity he will surely get up and give you as much as you need.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,     $dev$Jesus once praised a man for being shameless. It is worth stopping on that. In His parable a friend arrives at midnight with nothing to feed an unexpected guest, so he goes to a neighbor's door and knocks — refused once, and knocking still. Jesus calls it "shameless audacity," and says it is exactly why the door finally opens.

Then He hands us the grammar of kingdom asking, and the tense matters. In the original, the verbs are continuous: ask, and keep on asking; seek, and keep on seeking; knock, and keep on knocking. Some answers simply live on the other side of persistence, and heaven has its reasons. Persistence purifies the request — casual wishes fall away, and only what you truly want survives the waiting. It enlarges the vessel — you grow while you knock, becoming a person who can actually hold the thing you are asking for. And it times the answer to the season it truly belongs in, so that mercy is not wasted arriving early.

Remember Daniel. He prayed, and the answer met resistance in the unseen realm; the messenger later told him the reply had been dispatched on the very first day, but was delayed twenty-one days in coming (Daniel 10:12–13). Daniel did not know that. He only knew he had prayed and heaven seemed silent. Yet he kept praying. What if he had stopped on day twenty?

That is the warning hidden in the grace: do not let day twenty be the day you quit. The door is not deaf. Often it is simply testing whether you are certain this request truly belongs to you — whether you will still be knocking when it swings open.

Renew your knuckles. The midnight door has never once been as closed as it felt.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What request did you quietly stop knocking on — and was it genuine wisdom that stopped you, or just fatigue dressed up as wisdom?

— What is worth resuming with "shameless audacity" this week?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,     $dev$Father, renew my knuckles. For the request You Yourself planted in me, I resume asking, seeking, and knocking — with the audacity of someone who knows whose door this is. Keep me knocking until it opens. Amen.

_May midnight doors open to your knocking this season._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 11:5–13; 18:1–8; Daniel 10:12–13$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Psalm 139:23–24', $dev$“Search me, God, and know my heart; test me and know my anxious thoughts. See if there is any offensive way in me, and lead me in the way everlasting.”$dev$),
  (10, 2, 'devotional', 'Devotional',      NULL,     $dev$For nine days you have been learning to ask better — of yourself, of your assumptions, of God. The final upgrade is the bravest of all: to stop asking the questions and hand God the right to ask them of you.

Look at who prays today's prayer. David — the man who asked more questions than almost anyone in Scripture, who interrogated giants and seasons and his own soul — ends his greatest psalm not with another question of his own, but by surrendering the interrogation entirely: "Search me. Test me. See. Lead." Four imperatives, all pointed at himself. This is the prayer of an open life: no locked rooms, no bushes to hide behind, no blind spots defended from inspection.

And it is, astonishingly, the safest prayer in the world. We flinch from being searched because we imagine a prosecutor with a sword. But look who is doing the searching. Just verses earlier David marveled, "How precious to me are your thoughts, God! How vast is the sum of them! Were I to count them, they would outnumber the grains of sand" (Psalm 139:17–18). The One asking to search you already thinks of you more tenderly and more often than you can count. He searches with a lamp, not a sword. He is looking for what to heal, not what to condemn.

So here is your commissioning as these ten days close. Live examined. Ask better of yourself. Ask boldly of God. And now, most freeing of all — let God ask freely of you.

The gate-opening question at Caesarea Philippi has a twin that never stops working. Alongside "Who do you say I am?" learn to pray its companion: "Lord — what do You say about me, and what are You asking of me now?"$dev$),
  (10, 3, 'talk',      'Talk it Over',     NULL,     $dev$— Is there a room in your life you have quietly kept off-limits to God's questions?

— What has this plan changed about the way you will ask — and be asked — from now on?$dev$),
  (10, 4, 'devotional', 'Pray',            NULL,     $dev$Search me, God, and know my heart; test me and know my anxious thoughts. See what I cannot see, say what I need to hear, and lead me in the way everlasting. I open every room to You, trusting that Your searching is love. Amen.

_May you live gladly examined — asked, answered, and led all your days._$dev$),
  (10, 5, 'reading',   'Go Deeper',        NULL,     $dev$Psalm 139; Hebrews 4:12–13$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
