-- Reseed first-steps with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'first-steps');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, '2 Corinthians 5:17', 'What Just Happened to You'),
  (2, 'Matthew 6:9', 'Learning to Talk With God'),
  (3, '1 Peter 2:2', 'Food for the New Life'),
  (4, 'Hebrews 10:24–25', 'You Need a Family'),
  (5, 'Romans 6:4', 'Baptism: Your Public Yes'),
  (6, 'John 14:16–17', 'The Helper Within'),
  (7, 'Acts 2:42', 'Walking It Out')
) AS v(n, ref, title) WHERE p.code = 'first-steps';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'first-steps'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', '2 Corinthians 5:17', $dev$“Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,     $dev$You may have woken up this morning and looked in the mirror and seen the same face you have always seen. Same history. Same regrets. Same reflection. And a quiet voice may have whispered: nothing really changed. But heaven would disagree with that mirror. When you believed in Jesus, something happened that your eyes could not photograph but the whole of heaven witnessed — you were made new.

Read Paul's words slowly. He does not say you were repaired, upgraded, or given a fresh coat of paint over old wood. He says a new creation has come. The old has gone; the new is here. This is the language of a fresh act of God, the same God who once spoke light into darkness now speaking life into you. The person who was separated from God by sin is gone. In his place stands someone forgiven, adopted, and indwelt by the very Spirit of God — because Christ carried your sins in his own body on the cross so that you might die to them and live (1 Peter 2:24).

Here is the truth to build your week on: your new life rests on what God did, not on what you feel hour to hour. A newborn baby does not feel born; it simply is born, and the feelings catch up later. You may not sense fireworks today, and that is completely normal. Faith is trusting the fact underneath the feeling.

So when the accusing voice returns — and it will — answer it not with your emotions but with God's Word: "to all who received him, to those who believed in his name, he gave the right to become children of God" (John 1:12). You received him. You believed. Therefore you are his child, right now, regardless of how ordinary this morning feels.

That is now the truest thing about you — truer than your past, truer than your fears, truer than your mirror.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What led you to say yes to Jesus — and what did you feel in the moment you did?

— Which feels more real to you today: your past, or your new life in Christ — and why?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,     $dev$Father, thank You for making me new — not improved, but new. I may not understand everything yet, and I may not feel dramatically different, but I choose to trust what You have said over what I feel. I am Yours. Teach me to walk, one step at a time.

_May the newness God has worked in you feel a little more real to you each morning this week._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,     $dev$2 Corinthians 5:14–21; John 1:12–13$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Matthew 6:9', $dev$“This, then, is how you should pray: ‘Our Father in heaven, hallowed be your name…’”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,     $dev$Imagine being handed a phone with a direct, always-open line to the most powerful person alive — and being told you may call any hour, about anything, and you will never be put on hold. You have been handed something greater. Prayer is simply talking with the God who is now your Father, and there has never been anyone easier to talk to.

Notice how Jesus begins the pattern his disciples begged him to teach: not "Almighty Sovereign of the Universe," but "Our Father." That single word changes everything. You are not approaching a distant official who must be flattered into listening; you are coming to a Father who already loves you and leaned in before you spoke. From that starting place Jesus sketches a simple shape — honor the Father, welcome his kingdom, ask for daily needs, ask forgiveness and forgive others, ask for protection from evil. Not a script to recite, but a set of rooms to move through.

The heart of it is this: prayer is relationship, not performance. You need no special vocabulary, posture, or accent. God has heard every kind of grammar humanity has ever spoken, and he treasures yours. So start small and honest — five real minutes in the morning beats an hour of pretending. Tell him the true thing, even if the true thing is "I don't know how to do this."

And remember that conversation runs two ways. Leave some quiet. God speaks — most often through his Word, sometimes through a settling peace, often through a growing conviction about what is right. You will not recognize his voice on day one, and you don't need to. You will learn it the way a small child learns a parent's voice long before understanding every word: simply by spending time near him.

Begin today. Five minutes. Your Father is already listening.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,     $dev$— When exactly today will you take your five minutes — what time, and where?

— What is the most honest thing you need to say to God right now, even if it isn't polished?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,     $dev$Our Father in heaven, teach me to pray — simply, honestly, daily. Thank You that You want conversation and not a performance, and that You lean in to listen before I even find the words. Here is my voice; I am learning Yours.

_May prayer become as natural to you as breathing, and as sweet to you as the company of a trusted friend._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,     $dev$Matthew 6:5–15; Luke 11:1–13$dev$),
  (3, 1, 'scripture',  'Today''s Reading', '1 Peter 2:2', $dev$“Like newborn babies, crave pure spiritual milk, so that by it you may grow up in your salvation.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,     $dev$No one has to teach a newborn to be hungry. Feeding is the first instinct of new life — the cry comes before the words, the appetite before the understanding. Peter reaches for exactly that picture to describe you: born again, and now built to crave the food that grows you. Your new life feeds on the Word of God.

Some people meet the Bible as a rulebook and flinch, expecting mostly warnings and finger-pointing. But listen to how Jesus himself framed it, quoting Scripture in the wilderness: man shall not live on bread alone, "but on every word that comes from the mouth of God" (Matthew 4:4). The Bible is not a cage; it is a table. It is the place where the God who saved you keeps speaking to you, feeding faith, steadying fear, and slowly reshaping how you see everything.

So how do you eat? Start where the face of Jesus is clearest — the Gospel of John. Take one chapter a day, or even half a chapter; this is a meal, not a race. Read slowly enough to notice. Underline what stirs you. And bring two simple questions to every passage: What does this show me about God? And what is one thing I can do about it today? That second question is where reading turns into living.

Do not be discouraged by the parts you don't yet understand — every reader has them, for life. You are not required to master the whole table today; you are only asked to eat the portion in front of you. Feed on what is clear, and the clarity will grow.

Here is the promise you can test this week: if you feed on the Word today, it will show tomorrow. Not in a flash, but the way nourishment always shows — in quiet, unmistakable strength.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,     $dev$— When and where will your daily reading actually happen — name the time and the place?

— What is one thing from what you read today that you can act on before the sun goes down?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,     $dev$Father, give me a real appetite for Your Word. As I open the Gospel of John this week, open my understanding along with the pages, and let what I read begin to show in how I actually live. I want to grow.

_May the Word of God taste sweeter to you with every day that you sit down to eat it._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,     $dev$John 1; Psalm 1:1–3$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Hebrews 10:24–25', $dev$“And let us consider how we may spur one another on toward love and good deeds, not giving up meeting together…”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,     $dev$Pull one glowing coal out of a fire and set it alone on the hearth. Within minutes its light fades; within a little while it is cold and grey. Nothing was wrong with the coal — it simply cannot stay hot alone. That is not weakness. That is design. And it is a picture of you.

The writer of Hebrews knew that some believers were quietly drifting away from gathering, and he pleaded with them not to give up meeting together. Notice his reasoning: it is when we are together that we "spur one another on toward love and good deeds." Faith was never meant to be a solo sport. When you were born again, you were not merely saved as an individual; you were born into a family — and no child thrives raised entirely alone.

So find a Bible-teaching church and plant yourself in it. Come with expectation rather than as an inspector hunting for flaws; remember that every church is a family of the forgiven, still under construction, and so are you. If there is a smaller group — a home group, a Bible study, a cell — join it, because faith grows fastest at close range, where people actually learn your name and ask about your week.

And receive this warning as kindly as it is meant: isolation is exactly where discouragement does its best and quietest work. The evening you least feel like gathering is usually the evening you most need to. The enemy of your soul is patient; he does not need to attack a lone coal — he only needs to keep it lonely.

Stay in the fire, and you will stay warm. Belong, and you will burn long after the coals that pulled away have gone cold.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Which church will you attend this Sunday — decided now, this moment, and not left to Saturday night?

— Who is one believer, a little further along than you, that you could ask to walk with you as an older brother or sister in the faith?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,     $dev$Father, lead me to the family You have already prepared for me. Give me the humility to let myself be known, and the courage to actually belong instead of watching from a safe distance. Keep me in the fire, close to the others You have given me.

_May you find a spiritual family that, before long, begins to feel like a homecoming._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,     $dev$Hebrews 10:19–25; Acts 2:42–47$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Romans 6:4', $dev$“We were therefore buried with him through baptism into death in order that, just as Christ was raised from the dead through the glory of the Father, we too may live a new life.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,     $dev$A wedding ring does not create a marriage — it announces one. It is a small, visible thing you wear so the whole world can read an invisible reality: I belong to someone, and I am not ashamed to say so. Baptism is the wedding ring of your new life, the outward sign of an inward covenant already made.

Look at the picture Paul paints in today's verse. Going down under the water portrays your old life buried with Christ; rising up out of it portrays your new life raised with him. The water preaches a sermon your mouth cannot: the person you used to be has died, and the person God has made you is alive. Baptism does not save you — Christ has already done that, once and for all — but it declares publicly and gladly whose you now are.

This is not an optional extra for the especially spiritual. Jesus himself walked into the Jordan to be baptized, and as he came up, heaven tore open and the Father's voice broke through: "This is my Son, whom I love." Later Jesus told his followers to baptize every new disciple (Matthew 28:19). So this becomes your first real act of glad obedience — and obedience, remember, is simply how love speaks out loud.

The lie that keeps many people out of the water is the feeling of not being ready, not being worthy, not being far enough along. Hear this clearly: the water is not a reward for the worthy; it is a step for the willing. Christ washes you clean — you simply say yes in public.

So speak to your pastor about baptism this month, not "someday." Do not wait to feel worthy. Come as you are, and let your going under and rising up preach the death and resurrection of Jesus to everyone standing on the shore.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What is holding you back from baptism — and when you name it honestly, is it a real reason or simply a fear?

— Who are the people you would most want standing there, watching you say your public yes?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, I want to follow You right into the water, just as You went into the Jordan. Arrange my baptism, calm the fears that make me hesitate, and let my going under and rising up preach Your death and resurrection to everyone who watches.

_May the day of your baptism become one of the sweetest, most unforgettable memories of your whole life._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,     $dev$Romans 6:1–11; Matthew 3:13–17; Acts 8:35–39$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'John 14:16–17', $dev$“And I will ask the Father, and he will give you another advocate to help you and be with you forever — the Spirit of truth… he lives with you and will be in you.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,     $dev$If the Christian life were a matter of gritting your teeth and trying harder to be good, most of us would collapse by Thursday. Willpower is a small and tired engine, and it was never meant to carry this weight. Here is the news that changes everything: you were not left to manage your new life alone.

On the night before he died, Jesus made his disciples an astonishing promise. He would ask the Father, and the Father would give them "another advocate" to be with them forever — the Spirit of truth, who "lives with you and will be in you." When you believed, that promise landed on you. The Holy Spirit — God himself, not merely an influence or a feeling — came to live inside you. Jesus called him the Helper: comforter in sorrow, teacher of truth, strength in temptation, guide in decision.

Sit with how completely this reshapes the way you grow. You are not trying to imitate a Jesus who is far away and long ago; you are cooperating with his Spirit who is near and now, working from the inside out. Sanctification stops being white-knuckled self-improvement and becomes a relationship you learn to yield to.

So learn to recognize him at work. When you feel a gentle nudge of conviction that something is wrong, that is not mere guilt — that is the Helper, and the wise response is to turn quickly and kindly, not to argue or hide. When a verse suddenly lights up with meaning you had read past a hundred times, that is the Spirit teaching. And you may keep asking to be filled, because Jesus said the Father delights to "give the Holy Spirit to those who ask him" (Luke 11:13).

You are not alone in the room, and you never will be again. The same God you pray to has moved in.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Where do you most need a Helper right now — is it comfort, clarity, or plain strength?

— Have you already sensed his gentle conviction or his teaching this week — and if so, how did you respond?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,     $dev$Holy Spirit, welcome — truly welcome — into every room of my life, even the ones I would rather keep closed. Fill me today. Teach me, comfort me, strengthen me, and make Jesus real to me from the inside out. I do not want to do this alone, and now I know I never have to.

_May you come to feel the Helper nearer to you than your own heartbeat this week._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,     $dev$John 14:15–27; Galatians 5:22–25$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'Acts 2:42', $dev$“They devoted themselves to the apostles’ teaching and to fellowship, to the breaking of bread and to prayer.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,     $dev$Twenty centuries ago, the very first believers exploded into a life so full it turned the world upside down. And when Luke wants to tell us their secret, he does not describe a strategy or a program. He gives us four simple devotions: the apostles' teaching, fellowship, the breaking of bread, and prayer — the Word, the family, worship at the table, and talking with God. That is it. That is the recipe, and after two thousand years it has never been improved upon.

Look back over this week and you will find you have already tasted all four. You learned what happened to you and how to feed on Scripture — the Word. You discovered why you need a church — the family. You looked at baptism and the table where we remember Jesus — worship. And you began learning to pray — the ear of God, always open. What was a week of lessons now becomes simply your walk.

So set your expectations honestly, the way you would for any real journey. This is not a sprint fueled by feelings; it is a long, good path of small faithful steps. Some mornings the Word will burn in you; other mornings it will feel like dry bread. Feelings will come and go like weather — but the covenant God made with you stays fixed underneath them all.

And you will stumble. Every child learning to walk falls, and falling is not the same as failing. When you sin, remember the family rule and let it lift you fast: "If we confess our sins, he is faithful and just and will forgive us" (1 John 1:9). Get up quickly; the Father's hand is already extended toward you.

Then begin, quietly, to tell your story. You do not need a seminary degree to testify — "I once was blind, but now I see" has been enough for two thousand years, and it is enough for you. Your journey of becoming has begun. Keep walking.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Of the four devotions — the Word, the family, worship, and prayer — which one will need the most deliberate intention from you?

— Who is the first person you will tell about what has happened to you this week?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I set my feet on the path You have shown me: Your Word to feed on, Your family to belong to, Your table to gather at, and Your ear always open to me. Hold my hand when I stumble, lift me quickly when I fall, and make my small story a doorway that someone else can walk through to find You. I am walking.

_May every step of your new walk be steadied by the God who has promised to finish what He began in you._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,     $dev$Acts 2:41–47; 1 John 1:5–9$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
