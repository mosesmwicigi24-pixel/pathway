-- Covenant Love (10 days): NEW plan seeded from the author's PDF (source of truth).
-- Each day: key verse (scripture) -> Devotional -> Talk it Over (Reflect) ->
-- Pray (+blessing) -> Go Deeper. Re-runnable: plan upserts by code and days
-- are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('covenant-love', 'Covenant Love', 'Ten days on marriage, commitment and vows — building a love that is caused to work', 'Marriages are caused to work — they do not work by themselves. That single sentence, learned in the trenches of real covenant, separates the flourishing from the frustrated. Love is not a weather condition that visits some houses and skips others; it is a house that two forgiving people build, daily, with heaven''s materials. This plan is for the married, the engaged, and the wisely preparing. We will look at the mystery (marriage preaches Christ and His church), the mechanics (words, investment, love and respect), and the covenant-keeping God who witnesses every vow. Marriage is the coming together of two for-giving people — not two needy people. Ten days from now, you will know the difference, and how to build with it.', 'Love', 10, 26, 'https://images.unsplash.com/photo-1519741497674-611481863552?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'covenant-love');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Ephesians 5:25, 32', 'The Mystery Marriage Preaches'),
  (2, 'Genesis 2:24', 'One Flesh by Design'),
  (3, 'Colossians 3:13', 'Two Forgiving People'),
  (4, 'Proverbs 15:4', 'Caused to Work — With Words'),
  (5, 'Ephesians 5:33', 'Love and Respect: The Two Constants'),
  (6, 'Matthew 6:21', 'Invest Where Your Heart Is'),
  (7, 'Hebrews 13:4; Ecclesiastes 5:4–5', 'Keep Your Vows, Guard Your Bed'),
  (8, '1 Peter 4:8', 'Children Second — For Their Sake'),
  (9, '1 Peter 3:7', 'The Couple That Prays'),
  (10, 'Proverbs 22:1', 'A Great Name to Leave Behind')
) AS v(n, ref, title) WHERE p.code = 'covenant-love';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'covenant-love'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Ephesians 5:25, 32', $dev$“Husbands, love your wives, just as Christ loved the church and gave himself up for her… This is a profound mystery — but I am talking about Christ and the church.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Begin at the summit: marriage is not merely a social arrangement — it is a sermon. Paul unveils the mystery: every marriage is a living picture of Christ and His church. The husband’s sacrificial love preaches the Bridegroom who gave Himself; the wife’s glad partnership preaches the church’s joyful yes.

This is why covenant matters more than convenience, and why the enemy invests so heavily against marriages: every home that loves well is a pulpit he cannot silence.

It also sets the standard beyond our own strength — “as Christ loved the church” is not achievable by willpower — and that is the good news. The Bridegroom Himself supplies the grace for the picture He designed. This plan begins there: not with techniques, but with the Christ whose love your covenant was built to display.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— If your marriage (or preparation for it) is a sermon, what is it currently preaching?

— Where do you need the Bridegroom’s own grace rather than more willpower?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, Bridegroom of the church, make my covenant a true sermon of You. Supply the grace the picture requires — I cannot paint it alone, and I was never meant to. Amen.

_May your home preach Christ so clearly that visitors leave having heard the gospel._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 5:21–33; Revelation 19:6–9$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Genesis 2:24', $dev$“That is why a man leaves his father and mother and is united to his wife, and they become one flesh.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Before sin, before culture, before ceremony — marriage was God’s own architecture: leave, be united, become one flesh. Each verb carries a load. Leave: the old primary loyalties are honorably reordered; parents are honored, but the covenant now comes first. Be united — literally, glued: a bond designed to hold under weight, not a convenience to peel off when tested.

One flesh: two whole lives fused into a new entity — finances, futures, bodies, dreams — so that harming your spouse becomes self-harm, and blessing your spouse becomes self-blessing.

Much marital pain is simply architecture violated: unleft parents ruling a home, unglued commitment kept half-packed, oneness withheld in secret accounts and private kingdoms. Rebuild to the blueprint: what needs leaving, what needs gluing, what still resists the beautiful merger?$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Which verb needs work in your covenant — leaving, uniting, or one-fleshing?

— What “private kingdom” have you kept outside the merger?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Designer of marriage, rebuild us to Your blueprint: loyalties rightly ordered, bond glued beyond testing, two lives truly one. I surrender my private kingdoms. Amen.

_May the Architect’s original design be restored, beam by beam, in your house._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 2:18–25; Matthew 19:4–6$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Colossians 3:13', $dev$“Bear with each other and forgive one another if any of you has a grievance against someone. Forgive as the Lord forgave you.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Marriage is the coming together of two for-giving people — not two needy people. Read that carefully, for it corrects the age’s greatest marital lie: that a spouse exists to complete you, fill you, and meet the needs a wounded heart brings to the altar. Two needy people make a contract of extraction; two forgiving people make a covenant of grace.

There are many who prayed for a shoulder to cry on — and now are cried upon all the time. That is not a curse; it is covenant reality: you married a forgivable human, and so did they.

Daily forgiveness is therefore not marriage’s emergency equipment; it is its engine oil. “Forgive as the Lord forgave you” — quickly, thoroughly, repeatedly. Come to the covenant as a giver, keep short accounts, and watch what grace builds where extraction once bargained.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Did you come to (or approach) marriage primarily as a giver or a needer?

— What grievance needs the engine oil of forgiveness this very evening?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, convert me from a needy spouse to a for-giving one. Fill my needs at Your table so I come to our table full — and quick to forgive as You forgave me. Amen.

_May your covenant run smooth on the daily oil of swift forgiveness._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Colossians 3:12–15; Matthew 18:21–22$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Proverbs 15:4', $dev$“The soothing tongue is a tree of life, but a perverse tongue crushes the spirit.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Marriages are caused to work — they do not work by themselves. And the most effective tools ever used for building marriages are words. Every couple has a unique language, but the baseline is universal: couples must talk to each other, not against each other. Breakdown in communication is the root cause of a multitude of marital problems.

Words in a home are either construction or demolition; there is no neutral speech in a covenant. The daily compliment, the gentle answer that turns away wrath, the update phone call, the “thank you” for the thousandth meal — bricks, all of them. The public correction, the comparison, the silence used as a weapon — demolition.

So put the tools to work deliberately: one honest conversation this week without a screen in the room; one specific compliment daily; grievances raised privately, gently, promptly. Talk to each other. The house rises or falls on it.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Is the current ratio of your words building or demolishing your home?

— Schedule it: when is this week’s unhurried, screen-free conversation?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, set a guard over our words at home. Make my tongue a tree of life to my covenant — building daily, correcting privately, thanking constantly. Amen.

_May the words spoken in your house this week build something visible by year’s end._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 15:1–4; James 1:19; Ephesians 4:29$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Ephesians 5:33', $dev$“However, each one of you also must love his wife as he loves himself, and the wife must respect her husband.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$In marriage there are two constants that must be maintained: love and respect. Scripture assigns them with striking precision — husbands are commanded to love, wives to respect — because each speaks the deep language of the other’s heart. When she says “he doesn’t love me” and he says “she doesn’t respect me,” they are reporting the same drought from two shores.

Love, translated practically, sounds like: quality time, attention and listening, consultation before decisions, gifts and surprises, help with the home, daily compliments, protection from third parties. Respect sounds like: honor in public always, correction in private only, no comparisons with other men, a covenant kept confidential from the neighborhood.

And here is the covenant secret: the constants are unconditional — love not because she earned it today; respect not because he deserved it today — as unto the Lord. Whoever goes first, wins first.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which constant is running low in your covenant — and which do you owe?

— Choose two practical expressions from today’s lists to deliver this week.$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, teach me my spouse’s language: love that is felt, respect that is heard. I will pay the constants unconditionally, as unto You — and I will go first. Amen.

_May love and respect flow in your house like two rivers that never run dry._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 5:22–33; 1 Peter 3:1–7$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Matthew 6:21', $dev$“For where your treasure is, there your heart will be also.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$We invest in many things — school fees, businesses, land — but how much do we deliberately invest in our marriages? Show me where your money and your calendar go, and I will show you where your heart is. Many marriages are not dying of hatred; they are dying of under-investment.

So run the two audits of a covenant’s health: your schedule — does your spouse get prime hours or leftovers scraped from the day’s edge? your finances — when did you last spend deliberately on the covenant itself: the outing, the getaway, the counsel, the book, the course?

Couples who will not invest in counsel and unhurried talking pay for the neglect at far higher rates later. Budget for your covenant the way you budget for what you love — because the budget is the proof of the love.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Run the audits honestly: what do your schedule and money say your heart treasures?

— What covenant investment — time or treasure — will you book this month?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, expose my real portfolio. I redirect treasure and time to the covenant You gave me — and let my budget begin to tell the truth about my love. Amen.

_May every shilling and hour you invest in covenant return a hundredfold in peace._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 6:19–21; Song of Songs 2:15$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Hebrews 13:4; Ecclesiastes 5:4–5', $dev$“Marriage should be honored by all, and the marriage bed kept pure… When you make a vow to God, do not delay to fulfill it… It is better not to make a vow than to make one and not fulfill it.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Your wedding day was not a party with paperwork; it was an oath sworn before the covenant-keeping God — and heaven files vows. “When you make a vow to God, do not delay to fulfil it.” The God who witnessed your promises attends their keeping.

Guarding the covenant is therefore holy work, and it is mostly done early and quietly: the flirtation declined at the first hint, the private counsel of the opposite sex avoided, the marriage’s struggles kept out of sympathetic wrong ears — protection from third parties is love in armor. Little foxes ruin vineyards; catch them small.

And where a vow has already been broken — hear the gospel: the God of new grace restores covenant-breakers who repent (remember David). But from today, the standard stands: honored by all, kept pure, promises fulfilled. A kept vow is one of the most powerful sermons a life can preach.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where do “little foxes” currently have access to your vineyard?

— What early, quiet guard will you set this week?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Covenant-keeping God, I renew my vows before You today. Set my guards early, keep my bed pure, and make my kept promises a sermon my children can build on. Amen.

_May your kept vows become the safest walls your family ever lives within._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Ecclesiastes 5:1–7; Hebrews 13:4; Song of Songs 2:15$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '1 Peter 4:8', $dev$“Above all, love each other deeply, because love covers over a multitude of sins.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is counsel that sounds shocking until it saves your family: children are important, but they must come second to your covenant love. The parent who loves the children at the expense of the partner discovers a bitter mathematics later — trying to love the children double to replace a lost partner’s love, or losing the ability to love them well at all.

The deepest security a child can have is not toys, schools, or even direct attention — it is the visible, unshakeable love between father and mother. A strong covenant is the roof; the children live under it. Sacrifice the roof for the rooms and everyone gets rained on.

So love your children lavishly — bless them with words and prayers, be present, create memories — but let them daily witness a marriage that comes first. You are not neglecting them; you are securing them.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Has the covenant quietly slipped below the children — or below work, ministry, parents?

— What visible act this week will show your children the roof is strong?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, order my loves: You first, covenant second, children secured beneath it. Let our children grow up under the roof of a love they never have to doubt. Amen.

_May your children sleep their whole childhood under the roof of an unshakable covenant._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$1 Peter 4:8; Genesis 2:24; Psalm 128$dev$),
  (9, 1, 'scripture', 'Today''s Reading', '1 Peter 3:7', $dev$“Husbands… be considerate as you live with your wives, and treat them with respect… so that nothing will hinder your prayers.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Peter connects two rooms most couples keep separate: the bedroom and the prayer room. Live inconsiderately with your spouse, he warns, and your prayers themselves are hindered — covenant health and spiritual power share one pipeline.

The reverse is gloriously true: the couple that prays together forms the cord of three strands that is not quickly broken — two hearts with Christ Himself as the binding strand. Agreement in prayer between spouses is covenant’s secret weapon: “if two of you on earth agree about anything they ask for, it will be done for you” (Matthew 18:19) — and no two on earth can agree deeper than one flesh.

Start smaller than you think: a hand held and three sentences of prayer at bedtime; grace over meals; one weekly moment praying for each child by name. The couple that kneels together stands together — and heaven attends their house.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What currently hinders prayer in your house — and what would clear the pipeline?

— Design your smallest sustainable rhythm: when will you pray together, starting tonight?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, make us a praying covenant. Clear the pipeline between our love and our altar, and let our smallest nightly prayers weave the cord no trouble can break. Amen.

_May a lifetime of small prayers together become the strongest thing you ever built._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$1 Peter 3:1–7; Matthew 18:19–20; Ecclesiastes 4:12$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Proverbs 22:1', $dev$“A good name is more desirable than great riches; to be esteemed is better than silver or gold.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$A son once reflected on the father he lost too early — the questions never asked, the lessons never received, the ache of hearing other children speak of their fathers. And yet one inheritance outlived the loss: he left us a great name. Known for hard work, for great generosity, a man of peace. “In many ways,” the son wrote, “I want to be like my father.”

That is covenant’s longest reach: beyond your lifetime, a name — the reputation of your love, the pattern of your faithfulness, the peace of your house — becomes the inheritance your children carry when they can no longer carry you.

So close this plan with the long view: build a covenant worth being remembered by. Love deliberately, forgive daily, invest visibly, keep your vows, pray together — and to the preparing and single: build the foundation now, yoked only with the faith you share (2 Corinthians 6:14). Your great-grandchildren are already downstream of the love you build this year.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— If your covenant ended its story today, what name would it leave?

— What will you build this year that your children’s children will inherit?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, give us the long view. Build through our covenant a great name — hard work, generosity, peace, faithfulness — an inheritance our children’s children will thank You for. Amen.

_May the name your covenant leaves behind be spoken with gratitude for a hundred years._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 22:1; Psalm 112:1–3; 2 Corinthians 6:14$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
