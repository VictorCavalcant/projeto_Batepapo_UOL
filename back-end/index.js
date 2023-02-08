import express from "express";
import cors from "cors";
import chalk from "chalk";
import joi from "joi";
import { MongoClient, ObjectId} from "mongodb";
import dotenv from "dotenv";
import dayjs from "dayjs";
import { strict as assert } from "assert";
import { stripHtml } from "string-strip-html";

//TODO: lembrar que a coleção "chat" não existe e as mensagens deve ir para coleção("messages") e os participantes para coleção("participants")

const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();

let db = null;
const mongoClient = new MongoClient(process.env.MONGO_URL);
const promise = mongoClient.connect();
promise.then(() => {
	db = mongoClient.db(process.env.BANCO_MONGO);
	console.log(chalk.blue.bold("Conexão ao Banco de Dados efetuada com sucesso!"));
});
promise.catch(e => console.log(chalk.red.bold("Não foi possivel conectar ao banco!")));


async function removeLastestStatuses() {
	try{
	const time_now = Date.now();
	const participants = await db.collection("participants").find({}).toArray();
	if (!participants) {
			return
	}
	const lastestStatus = participants.find(p => time_now - p.lastStatus > 10000);
	if (!lastestStatus) {
		return
	}
	const exitMessage = {
			from: lastestStatus.name,
			to: 'Todos',
			text: 'sai da sala...',
			type: 'status',
			time: dayjs().format("hh:mm:ss")
	};
	await db.collection("messages").insertOne(exitMessage);
	await db.collection("participants").deleteOne(lastestStatus);
	} catch(error) {
		console.log("Alguma coisa está errada!", error);
	}

}
setInterval(removeLastestStatuses,15000);


app.post("/participants", async(req,res) => {
	// Formato de um participante : {name: 'xxx', lastStatus: Date.now()}
	const body = req.body;

	const participantSchema = joi.object({
			name: joi.string().required()
	});

	const {error} = participantSchema.validate(body, {abortEarly: false});

	if(error) {
		return res.status(422).send(error.details.map(detail => detail.message));
	}

	try{

		// Sanitização dos dados - Nome
		const clearName = stripHtml(body.name, {
		stripTogetherWithTheirContents: [
			"script", // default
			"style", // default
			"xml", // default
			"pre", // <-- custom-added
		],
	});

		// Remoção de espaços no começo e no final
		const new_name = clearName.result.trim();
//

	const name_Clear = {	
			name: new_name
	}


		const findParticipant = await db.collection("participants").findOne({name: new_name});

		if (findParticipant) {
			res.sendStatus(409);
			return mongoClient.close;
		}

		const joinMessage = {
			from: new_name,
			to: 'Todos',
			text: 'entra na sala...',
			type: 'status',
			time: dayjs().format('HH:mm:ss')
		}

		await db.collection("participants").insertOne({...body,name: new_name,lastStatus: Date.now()});
		await db.collection("messages").insertOne(joinMessage);
		res.status(201).send(name_Clear);

	} catch (e){
		res.sendStatus(500);
		console.log("erro ao criar o participante ou enviar a mensagem de entrada!")
		mongoClient.close();
	}

});

app.get("/participants", async(req, res) => {
	try {
		const participants = await db.collection("participants").find({}).toArray();
		res.send(participants);
	} catch(e){
		res.sendStatus(500);
		console.log("erro ao pegar os participantes!")
		mongoClient.close();
	}
})

app.post("/messages", async(req,res) => {
	// Formato de uma mensagem : body => {to: "Maria", text: "oi sumida rs", type: "private_message"}
	// O from é atráves do user(header)

	const body = req.body;
	const {user} = req.headers;
	const typeRegex = /(?=message|private_message)/;

	const messageSchema = joi.object({
		to: joi.string().required(),
		text: joi.string().required(),
		type: joi.string().pattern(typeRegex).required()
	});

	const {error} = messageSchema.validate(body, {abortEarly: false});

	const checkUser = await db.collection("participants").findOne({name: user});

	if(!checkUser) {
		res.sendStatus(422);
	}

	if (error) {
		return res.status(422).send(error.details.map(detail => detail.message));
	}

	try {

		// Sanitização dos dados - Messagem

		const clearMessage = stripHtml(body.text, {
			stripTogetherWithTheirContents: [
				"script", // default
				"style", // default
				"xml", // default
				"pre", // <-- custom-added
			],
		});

		// Remoção de espaços no começo e no final
		const new_message = clearMessage.result.trim();
		//

		await db.collection("messages").insertOne({from: user,...body,text: new_message,time: dayjs().format('HH:mm:ss')}) 
		res.sendStatus(201);
	} catch(e){
		res.sendStatus(500);
		console.log("erro ao enviar a mensagem!");
		mongoClient.close();
	}

});

app.get("/messages", async(req,res) => {
	const {limit} = req.query;
	const {user} = req.headers;

	try {
		const messages = await db.collection("messages").find({ $or: [{"from": user}, {"to": user}, {"to" : "Todos"}]}).toArray();
		const limitMessages = [...messages].splice(0, limit);
	

		if (limit) {
			return res.send(limitMessages);
		} else {
			return res.send(messages);
		}
	} catch(e) {
		res.sendStatus(500);
		console.log("erro ao pegar as mensagens!");
		mongoClient.close();
	}

})

app.post("/status", async(req,res) => {
	const {user} = req.headers;

 try {
		const checkUser = await db.collection("participants").findOne({name: user});
		if (!checkUser) {
			return res.sendStatus(404);
		}

		await db.collection("participants").updateOne({name: user},{$set: {lastStatus: Date.now()}})
		res.sendStatus(200);

 } catch(e){
		res.sendStatus(500);
		console.log("erro ao atualizar o status!")
		mongoClient.close();
 }

})


app.delete("/messages/:idMessage", async(req, res) => {
	// Formato de uma mensagem : body => {to: "Maria", text: "oi sumida rs", type: "private_message"}
	// O from é atráves do user(header)

	const {idMessage} = req.params;
	const {user} = req.headers;
	try {
		const findMessage = await db.collection("messages").findOne({_id: new ObjectId(idMessage)});
		console.log("Valor de findMessage: ", findMessage);
		if (!findMessage) {
			return res.sendStatus(404);
		}

		const checkOwnerMessage = findMessage.from;
		console.log("Valor de checkOwnerMessage: ", checkOwnerMessage);
		if(checkOwnerMessage != user) {
			return res.sendStatus(401);
		}
		
		await db.collection("messages").deleteOne(findMessage);

	} catch(error) {
		console.log("Erro ao deletar mensagem!", error);
	}

})

app.put("/messages/:idMessage", async(req, res) => {

	// Formato de uma mensagem : body => {to: "Maria", text: "oi sumida rs", type: "private_message"}
	// O from é atráves do user(header)

	const {idMessage} = req.params;
	const {user} = req.headers;

	try {
	const body = req.body;
	const typeRegex = /(?=message|private_message)/;


	const messageSchema = joi.object({
		to: joi.string().required(),
		text: joi.string().required(),
		type: joi.string().pattern(typeRegex).required()
	});

	const {error} = messageSchema.validate(body, {abortEarly: false});

	const checkUser = await db.collection("participants").findOne({name: user});

	if(!checkUser) {
		res.sendStatus(422);
	}

	if (error) {
		return res.status(422).send(error.details.map(detail => detail.message));
	}

	// Sanitização dos dados - Messagem

	const clearMessage = stripHtml(body.text, {
		stripTogetherWithTheirContents: [
			"script", // default
			"style", // default
			"xml", // default
			"pre", // <-- custom-added
		],
	});

	// Remoção de espaços no começo e no final
	const new_message = clearMessage.result.trim();

	//

	const findMessage = await db.collection("messages").findOne({_id: new ObjectId(idMessage)});

	if (!findMessage) {
		return res.sendStatus(404);
	}

	const checkOwnerMessage = findMessage.from;

	if(checkOwnerMessage != user) {
		return res.sendStatus(401);
	}

	await db.collection("messages").updateOne({_id: new ObjectId(idMessage)}, {$set: {to: body.to, text: new_message, type: body.type}})


	} catch(error) {
		console.log("erro ao atualizar a mensagem!", error);
	}
})

//TODO: lembrar que a coleção "chat" não existe e as mensagens deve ir para coleção("messages") e os participantes para coleção("participants")

app.listen(process.env.PORTA, () => {
	console.log(chalk.green.bold("Rodando na porta 5000 de boa"));
});