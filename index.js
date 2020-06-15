const express = require('express');
const hostname = 'localhost'; 
const port = 8080; 
const app = express(); 
const mysql = require('mysql');
const url = require('url'); 
const fs = require('fs');
const routes = express.Router();
var bodyParser = require('body-parser')

const server = app.listen(port, () => { 
	console.log(`Server running at http://${hostname}:${port}/`); 
}); 

const io = require('socket.io')(server);

var con = mysql.createConnection({
    host: hostname,
    user: "root",
    password: "nmr0930",
    database: "OTProject"
  });



io.on('connection', (socket) => {
	console.log('a user connected');
	io.emit('connected', '');
  
	socket.on('disconnect', () => {
	  console.log('user disconnected');
	});
});
  

con.connect(function(err) {
if (err) throw err;
console.log("Connected!");
});

// parse application/json
app.use(bodyParser.json())
  
app.use((req, res, next) => { 
  console.log(req.headers); 
  res.statusCode = 200; 
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept"); 
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE");
  next()
}); 

app.get('/patients/general', function (req, res) {
  let sql = "SELECT pid, avatar, age_year AS ageYear, age_month as ageMonth, DATE_FORMAT(birthdate, '%Y-%m-%d') AS birthdate, DATE_FORMAT(evaldate, '%Y-%m-%d') AS evaldate FROM patient;"

  con.query(sql, function (err, result) {
    if (err) res.send(err);
    res.send(result);
  });
})


app.post('/patients/general', function (req, res) {
  const { birthdate, month, age } = req.body
  let iconFile;

  fs.readdir("./icons", (err, files) => {
    iconFile = files[Math.floor(Math.random()*files.length)];
    let sql = `INSERT INTO patient (birthdate, age_year, age_month, evaldate, avatar) VALUES (CAST("${birthdate}" AS DATE), ${age}, ${month}, NULL, "${iconFile}");`

    con.query(sql, function (err, result) {
      if (err) res.send({message: "New patient was not able to be added."});

      else { 
		  io.emit('listupdate', '')
		  res.send({message: "New patient has been added!"}); 
		}
    }); 
  })
})

app.get('/patients/:pid', function(req, res) {
  let [, , id ] = req.url.split("/")

  function raw_score() {
    let patientQuery = `SELECT * FROM patient_raw WHERE pid = ${id}`
    let concatCategoryAndValue = `SELECT pid, concat (category, "-", raw_score, "-", IFNULL(age_equivalent,"")) AS raw_data FROM (${patientQuery}) AS patient_data`
    return `SELECT pid, GROUP_CONCAT (raw_data SEPARATOR ",") AS rawData FROM (${concatCategoryAndValue}) AS patient_data`
  } 

  function standard_score() {
    let patientQuery = `SELECT * FROM patient_standard WHERE pid = ${id}`
    let concatCategoryAndValue = `SELECT pid, concat (category, "-", standard_score, "-", score_level, "-", percentile, "-", scaled_score) AS standard_data FROM (${patientQuery}) AS patient_data`
    return `SELECT pid, GROUP_CONCAT (standard_data SEPARATOR ",") AS standardData FROM (${concatCategoryAndValue}) AS patient_data`
  } 

  let sql = `SELECT * 
             FROM (SELECT pid, DATE_FORMAT(birthdate, '%Y-%m-%d') AS birthdate, age_year as ageYear, age_month as ageMonth, DATE_FORMAT(evaldate, '%Y-%m-%d') AS evaldate, avatar FROM patient WHERE pid = ${id})
             p LEFT JOIN (${raw_score()}) pr ON p.pid = pr.pid LEFT JOIN (${standard_score()}) pl ON pr.pid = pl.pid ;`

  con.query(sql, function (err, [patient]) {
    if (err) res.send(err);

	let newPatient = Object.assign({}, patient)
	newPatient.vmiData = {}
	newPatient.vpData = {}
	newPatient.mcData = {}
    
    patient.rawData && patient.rawData.split(",").forEach(categoryData => {
      let [category, rawScore, ageEquivalent] = categoryData.split("-")
      newPatient[category] = Object.assign(newPatient[category+"Data"], { rawScore, ageEquivalent })
    })

    patient.standardData && patient.standardData.split(",").forEach(categoryData => {
      let [category, standardScore, level, percentile, scaledScore] = categoryData.split("-")
      newPatient[category] = Object.assign(newPatient[category+"Data"], { standardScore, level, percentile, scaledScore })
    })
	
    res.send(newPatient);
  });  
})

app.delete('/patients/:pid', function (req, res) {
	let [, , id ] = req.url.split("/")
	let sql = `DELETE FROM patient p WHERE p.pid = ${id}`

	con.query(sql, function (err, result) {
		if (err) res.send({message: "Deletion was not successful"});
  
		else { 
			io.emit('listupdate', '')
			res.send({message: "Deletion was successful!"}); 
		}
	}); 
})

app.post('/patients/:pid/scores', function(req, res) {
  const {pid, ageYear, ageMonth, vmi, vp , mc, newEvaldate} = req.body

  console.log(req.body)

  let sql = `CALL NewEval(${pid}, ${vmi}, ${vp}, ${mc}, ${ageYear}, ${ageMonth}, "${newEvaldate}")`

  con.query(sql, function (err, result) {
	if (err) {
		res.send({ message: `Patient age and ${err.sqlMessage} score did not match any standard scores. Please verify your input.`});
	}
    
    else { 
		io.emit(`${pid}-update`, '')
		res.send({ message: "New eval has been successfully submitted!"}) 
	};
  });  
})