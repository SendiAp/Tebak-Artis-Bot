const {Telegraf, Telegram} = require("telegraf")
const config = require("./config")
config.botId = Number(config.token.match(/^\d+/)[0])
const db = require("./db")
const fs = require("fs")
const {numberWithSpaces, arrayRandom, trueTrim, plusminus, pluralize, bold} = require("./functions")
const telegram = new Telegram(config.token)
const bot = new Telegraf(config.token)

let gameStates = {}
const createGameState = chatId => {
	gameStates[chatId] = {
		timeouts: {},
		guessMessage: null,
		currentRound: null,
		currentTime: 0,
		answersOrder: [],
	}
	return gameStates[chatId]
}
const getAddToGroupButton = botUsername => ({
	reply_markup: {
		inline_keyboard: [
			[
				{
					text: "➕ tambahkan saya kegrub ➕",
					url: `https://t.me/${botUsername}?startgroup=add`,
				},
			],
		],
	},
})
const getGreetMessage = ({botUsername}) => [
	trueTrim(`
	__Halo everyone,saya adalah bot tebak umur artis__  •tambahkan saya kegrub dan semua perintah akan berfungsi•

	tekan /help untuk meminta bantuan 
`),
	getAddToGroupButton(botUsername),
]
const getOnlyGroupsMessage = botUsername => [
	"⛔ Bot ini hanya tersedia untuk *obrolan grup *. Buat obrolan dengan teman dan tambahkan bot di sana.",
	getAddToGroupButton(botUsername),
]
const getRandomPerson = () => {
	let imagePath = "./photos"
	let fimeName = arrayRandom(fs.readdirSync(imagePath))
	let age = Number(fimeName.match(/^(\d+)/)[1])
	return {
		age: age,
		photo: `${imagePath}/${fimeName}`,
	}
}
const iterateObject = (obj, f) => {
	let index = 0
	for (let key in obj) {
		f(key, obj[key], index)
		index++
	}
}
const createChat = chatId => {
	console.log("createChat")
	let data = {
		isPlaying: true,
		members: {},
	}
	db.insert(chatId, data)
}
const createMember = firstName => {
	console.log("createMember")
	return {
		firstName: firstName,
		isPlaying: true,
		answer: null,
		gameScore: 0,
		totalScore: 0,
	}
}
const getChat = chatId => {
	return db.get(chatId)
}
const stopGame = async (ctx, chatId) => {
	console.log("stopGame")
	let chat = getChat(chatId)
	if (chat && chat.isPlaying) {
		if (gameStates[chatId] && gameStates[chatId].timeouts) {
			for (let key in gameStates[chatId].timeouts) {
				clearTimeout(gameStates[chatId].timeouts[key])
			}
		}
		chat.isPlaying = false
		let top = []
		iterateObject(chat.members, (memberId, member, memberIndex) => {
			if (member.isPlaying) {
				top.push({
					firstName: member.firstName,
					score: member.gameScore,
				})

				Object.assign(member, {
					answer: null,
					isPlaying: false,
					gameScore: 0,
				})
			}
		})
		db.update(chatId, ch => chat)
		if (top.length > 0) {
			await ctx.replyWithMarkdown(
				trueTrim(`
					🏁 **Dan inilah pemenangnya:**

					${top
						.sort((a, b) => b.score - a.score)
						.map(
							(member, index) =>
								`${["🏆", "🎖", "🏅"][index] || "🔸"} ${index + 1}. ${bold(
									member.firstName
								)}: ${numberWithSpaces(member.score)} ${pluralize(
									member.score,
									"point",
									"point",
									"point"
								)}`
						)
						.join("\n")}

					✨Selamat Kepada Pemenang, Yang Telah Memenenangkan Game ini.
					🔄 /mulai - mau main lagi?
				`)
			)
		} else {
			await ctx.replyWithMarkdown(
				trueTrim(`
					*⛔ Oke, saya menyelesaikan permainan.*

					💁 Jika kamu butuh bantuan , tekan /help untuk melihatnya..
					🔄 /game - mau bermain lagi?
				`)
			)
		}
	} else {
		await ctx.reply("🙅 Permainan tidak berjalan.")
	}
}
const getRoundMessage = (chatId, round, time) => {
	let chat = getChat(chatId)
	let answers = []
	iterateObject(chat.members, (memberId, member, memberIndex) => {
		if (member.isPlaying && member.answer !== null) {
			answers.push({
				answer: member.answer,
				firstName: member.firstName,
				memberId: Number(memberId),
			})
		}
	})
	answers = answers.sort(
		(a, b) =>
			gameStates[chatId].answersOrder.indexOf(a.memberId) -
			gameStates[chatId].answersOrder.indexOf(b.memberId)
	)

	return trueTrim(`
		*Halaman Gambar ${round + 1}/${config.rounds}*
		Berapakah Umur Artis ini? Silahkan Jawab Dibawah.
		${
			answers.length > 0
				? `\n${answers
						.map(
							(member, index) =>
								`${index + 1}. *${member.firstName}*: ${member.answer}`
						)
						.join("\n")}\n`
				: ""
		}
		${"⬛".repeat(time)}${"⬜".repeat(config.timerSteps - time)}
	`)
}
const startGame = (ctx, chatId) => {
	console.log("startGame")
	let gameState = createGameState(chatId)
	let startRound = async round => {
		let person = getRandomPerson()
		let rightAnswer = person.age
		let guessMessage = await ctx.replyWithPhoto(
			{
				source: person.photo,
			},
			{
				caption: getRoundMessage(chatId, round, 0),
				parse_mode: "Markdown",
			}
		)
		gameState.currentTime = 0
		gameState.guessMessageId = guessMessage.message_id
		gameState.currentRound = round

		let time = 1
		gameState.timeouts.timer = setInterval(async () => {
			gameState.currentTime = time
			try {
				await telegram.editMessageCaption(
					ctx.chat.id,
					guessMessage.message_id,
					null,
					getRoundMessage(chatId, round, time),
					{
						parse_mode: "Markdown",
					}
				)
			} catch (err) {
				console.log(err)
			}
			time++
			if (time >= config.timerSteps + 1) clearInterval(gameState.timeouts.timer)
		}, config.waitDelay / (config.timerSteps + 1))

		gameState.timeouts.round = setTimeout(async () => {
			try {
				let chat = getChat(chatId)
				let top = []
				iterateObject(chat.members, (memberId, member, memberIndex) => {
					if (member.isPlaying) {
						let addScore =
							member.answer === null
								? 0
								: rightAnswer - Math.abs(rightAnswer - member.answer)
						chat.members[memberId].gameScore += addScore
						chat.members[memberId].totalScore += addScore
						top.push({
							firstName: member.firstName,
							addScore: addScore,
							answer: member.answer,
						})
						member.answer = null
						db.update(chatId, ch => chat)
					}
				})
				db.update(chatId, ch => chat)

				if (!top.every(member => member.answer === null)) {
					await ctx.replyWithMarkdown(
						trueTrim(`
						artis ini berumur *${rightAnswer} ${pluralize(
							rightAnswer,
							"umur",
							"point",
							"tahun"
						)}*. hasil, point kamu:

						${top
							.sort((a, b) => b.addScore - a.addScore)
							.map(
								(member, index) =>
									`${["🏆", "🎖", "🏅"][index] || "🔸"} ${index + 1}. ${bold(
										member.firstName
									)}: ${plusminus(member.addScore)}`
							)
							.join("\n")}
					`),
						{
							reply_to_message_id: guessMessage.message_id,
						}
					)
				} else {
					await ctx.reply("😏 Sepertinya Anda tidak bermain. Oke, saya menyelesaikan permainannya...")
					await stopGame(ctx, chatId)
					return
				}

				if (round === config.rounds - 1) {
					gameState.timeouts.stopGame = setTimeout(async () => {
						await stopGame(ctx, chatId)
					}, 1000)
				} else {
					gameState.answersOrder = []
					gameState.timeouts.afterRound = setTimeout(() => {
						startRound(++round)
					}, 2500)
				}
			} catch (err) {
				console.log(err)
			}
		}, config.waitDelay)
	}
	gameState.timeouts.beforeGame = setTimeout(() => {
		startRound(0)
	}, 1000)
}

bot.catch((err, ctx) => {
	console.log("\x1b[41m%s\x1b[0m", `Ooops, encountered an error for ${ctx.updateType}`, err)
})

bot.start(async ctx => {
	await ctx.replyWithMarkdown(
		...getGreetMessage({
			botUsername: ctx.botInfo.username,
			isGroup: ctx.update.message.chat.id < 0,
		})
	)
})

bot.command("mulai", async ctx => {
	console.log("mulai")
	let message = ctx.update.message
	if (message.chat.id < 0) {
		let chatId = message.chat.id
		let chat = getChat(chatId)
		if (chat) {
			if (chat.isPlaying) {
				return ctx.reply(
					"⛔ Anda sudah memulai permainan.Anda dapat menghentikannya dengan tim klik /stop."
				)
			} else {
				chat.isPlaying = true
				for (let key in chat.members) {
					let member = chat.members[key]
					member.gameScore = 0
				}
				db.update(chatId, ch => chat)
			}
		} else {
			createChat(chatId)
		}
		await ctx.replyWithMarkdown("💁*Permainan Dimulai!*")
		startGame(ctx, chatId)
	} else {
		await ctx.replyWithMarkdown(...getOnlyGroupsMessage(ctx.botInfo.username))
	}
})

bot.command("stop", async ctx => {
	console.log("stop")
	let message = ctx.update.message
	if (message.chat.id < 0) {
		let chatId = message.chat.id
		await stopGame(ctx, chatId)
	} else {
		await ctx.replyWithMarkdown(...getOnlyGroupsMessage(ctx.botInfo.username))
	}
})

bot.command("help", ctx => {
	console.log("help")
	return ctx.replyWithMarkdown(
		trueTrim(`
			Cara Memainkan Bot Tebak Umur Artis:

			1.)Masukan bot digrub anda (dan jadikan admin)
			2.)ketik /mulai untuk memulai gamenya 
			3.)kamu akan dikasih gambar artis,dan kamu akan disuruh menebak umurnya.
			4.)Waktu (3detik) dengan (5 foto) yang berbeda beda.
			5.)setiap kamu menjawab nya ,kamu akan mendapatkan point.
			6.)semakin besar point kamu , kamu akan mendapatkan peringkat di /top_global atau di /top_grub
			7.)peringkat akan direset setiap hari Senin (tidak ditentukan jam)
			8.) Setiap peringkat akan dimasukan channel setiap minggunya.
		`)
	)
})

bot.command("top_grub", async ctx => {
	console.log("top_grub")
	let message = ctx.update.message
	if (message.chat.id < 0) {
		let chatId = message.chat.id
		let chat = getChat(chatId)
		if (chat) {
			let top = []
			iterateObject(chat.members, (memberId, member, memberIndex) => {
				top.push({
					firstName: member.firstName,
					score: member.totalScore,
				})

				Object.assign(member, {
					answer: null,
					isPlaying: false,
					gameScore: 0,
				})
			})
			if (top.length > 0) {
				await ctx.replyWithMarkdown(
					trueTrim(`
					*🏅 Pemain terbaik dari obrolan ini adalah:*

					${top
						.sort((a, b) => b.score - a.score)
						.map(
							(member, index) =>
								`${["🏆", "🎖", "🏅"][index] || "🔸"} ${index + 1}. ${bold(
									member.firstName
								)}: ${numberWithSpaces(member.score)} ${pluralize(
									member.score,
									"point",
									"point",
									"point"
								)}`
						)
						.join("\n")}

					◻️ /mulai permainan untuk mendapatkan peringkat paling pertama digrub ini.
					🔄 apakah kamu tertarik? yu bermain lagi bersama teman mu!
				`)
				)
			} else {
				await ctx.reply("⛔ Anda belum memainkan satu game pun dalam obrolan ini.")
			}
		} else {
			await ctx.reply("⛔ Anda belum memainkan satu game pun dalam obrolan ini.")
		}
	} else {
		await ctx.replyWithMarkdown(...getOnlyGroupsMessage(ctx.botInfo.username))
	}
})

bot.command("top_global", async ctx => {
	console.log("top_global")
	const fromId = String(ctx.update.message.from.id)
	const data = db.read()
	let top = []
	iterateObject(data, (chatId, chat, chatIndex) => {
		iterateObject(chat.members, (memberId, member, memberIndex) => {
			const existingMember = top.find(topItem => topItem.id === memberId)
			if (existingMember) {
				if (member.totalScore > existingMember.score) {
					existingMember.score = member.totalScore
				}
			} else {
				top.push({
					id: memberId,
					firstName: member.firstName,
					score: member.totalScore,
				})
			}
		})
	})

	top = top.sort((a, b) => b.score - a.score)
	const topSlice = top.slice(0, 25)
	let currentUser
	if (!topSlice.find(item => item.id === fromId)) {
		let currentUserIndex
		const foundUser = top.find((item, index) => {
			if (item.id === fromId) {
				currentUserIndex = index
				return true
			}
		})
		if (foundUser) {
			currentUser = {...foundUser}
			currentUser.index = currentUserIndex
		}
	}

	if (top.length > 0) {
		await ctx.replyWithMarkdown(
			trueTrim(`
			*🌍 Peringkat Pemain Global:*

			${topSlice
				.map(
					(member, index) =>
						`${["🏆", "🎖", "🏅"][index] || "🔸"} ${index + 1}. ${
							fromId === member.id ? "Вы: " : ""
						}${bold(member.firstName)}: ${numberWithSpaces(member.score)} ${pluralize(
							member.score,
							"point",
							"point",
							"point"
						)}`
				)
				.join("\n")}
			${
				currentUser
					? `...\n🔸 ${currentUser.index + 1}. ${bold(
							currentUser.firstName
					  )}: ${numberWithSpaces(currentUser.score)} ${pluralize(
							currentUser.score,
							"point",
							"point",
							"point"
					  )}\n`
					: ""
			}
			🤖 Dapatkan peringkat teratas dengan cara bermain game ini.
			🥰 Tertarik dengan game ini?Beri Donasi agar bot akan terus berjalan.
		`)
		)
	} else {
		await ctx.reply("💁 Saat ini,tidak mungkin membuat peringkat.")
	}
})

bot.on("message", async ctx => {
	let message = ctx.update.message
	if (message.chat.id < 0) {
		let chatId = message.chat.id
		let fromId = message.from.id
		let chat = getChat(chatId)
		if (
			chat && //chat exist
			chat.isPlaying && //game exist
			(chat.members[fromId] === undefined || chat.members[fromId].answer === null) && //it's a new member or it's member's first answer
			gameStates[chatId] && //gameState was created
			/^-?\d+$/.test(message.text)
		) {
			let firstName = message.from.first_name
			let answer = Number(message.text)
			if (answer <= 0 || answer > 120) {
				return ctx.reply("Jawab di luar kisaran yang diizinkan (1 - 120)", {
					reply_to_message_id: ctx.message.message_id,
				})
			}
			if (!chat.members[fromId]) {
				//new member's answer
				chat.members[fromId] = createMember(firstName)
			}
			Object.assign(chat.members[fromId], {
				isPlaying: true,
				answer: answer,
				firstName: firstName,
			})
			gameStates[chatId].answersOrder.push(fromId)

			db.update(chatId, ch => chat)

			await telegram.editMessageCaption(
				chatId,
				gameStates[chatId].guessMessageId,
				null,
				getRoundMessage(
					chatId,
					gameStates[chatId].currentRound,
					gameStates[chatId].currentTime
				),
				{
					parse_mode: "Markdown",
				}
			)
		} else if (message.new_chat_member && message.new_chat_member.id === config.botId) {
			//bot added to new chat
			await ctx.replyWithMarkdown(...getGreetMessage({isGroup: true}))
		}
	}
})

bot.launch({dropPendingUpdates: true})
