var flightAwareBasePath = "https://flightxml.flightaware.com/json/FlightXML2/";
var flightAwareUsername = process.env["flightAwareUsername"]
var flightAwarePassword = process.env["flightAwarePassword"]
var buffer = Buffer.from(flightAwareUsername + ":" + flightAwarePassword);
var flightAwareAuthHeader = "Basic " + buffer.toString('base64');
var timezoneOffsetInSeconds = parseInt(process.env["timezoneOffset"], 10) * 60;

module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');

    if (req.query.flightNumber && req.query.flightNumber != ''
        && req.query.departureTime && req.query.departureTime != '' ) {

        let flightNumber = req.query.flightNumber;
        let departureTime = req.query.departureTime;
        let fligthId = getFlightId(flightNumber, departureTime);        
        let flightInfoResponseBody = await getFlightInfo(context, fligthId);

        if (flightInfoResponseBody.length < 40 && flightInfoResponseBody.indexOf("NO_DATA flight not found") > -1){
            context.res = {
                status: 404,
                body: "Flight '" + fligthId + "' Not Found"
            };            
        }
        else {
            let flights = JSON.parse(flightInfoResponseBody).FlightInfoExResult.flights;
            if (flights.length != 1) {
                context.res = {
                    status: 400,
                    body: "Bad Request. Flight Id '" + fligthId + "' did not return 1 flight."
                };            
            }
            else {
                let flightInfo = JSON.parse(flightInfoResponseBody).FlightInfoExResult.flights[0];
                let claimRefundRules = getClaimRefundRules(flightInfo);
                context.res = {
                    status: 200, 
                    body: claimRefundRules
                };
            }
        }
    }
    else {
        context.res = {
            status: 400,
            body: "Please pass flightNumber and date values in the query string"
        };
    }
};

async function getFlightInfo(context, flightId) {
    let request = require('request');
    let url = flightAwareBasePath + "FlightInfoEx";
    let queryParams = { 'ident': flightId };
    let headers = { 'Authorization': flightAwareAuthHeader}
    context.log(url + '?' + queryParams);

    return new Promise((resolve, reject) => {
        request({
            url:url, 
            qs:queryParams, 
            headers:headers, 
            method: 'GET'
            }, 
            function(err, response, body) {
                if (!err && response.statusCode == 200) {
                    resolve(body);
                }
                else {
                    reject(error);
                }
            }
        );
    });
}

function getFlightId(flightNumber, departureTime) {
    let yy = parseInt(departureTime.substring(0, 4), 10);
    let MM = parseInt(departureTime.substring(5, 7), 10) - 1;
    let dd = parseInt(departureTime.substring(8, 10), 10);
    let HH = parseInt(departureTime.substring(11, 13), 10);
    let mm = parseInt(departureTime.substring(14, 16), 10);
    let ss = parseInt(departureTime.substring(17, 19), 10);
    let departureTimeEpoch = new Date(yy, MM, dd, HH, mm, ss);
    departureTimeEpoch = departureTimeEpoch / 1000; 
    let runtimeTimezoneOffset = new Date().getTimezoneOffset();
    // If server timezone is UTC, add the offset configured to work with local time. 
    if (runtimeTimezoneOffset == 0) {
        departureTimeEpoch = departureTimeEpoch - timezoneOffsetInSeconds;
    }

    // Converts to epoch time
    return flightNumber + '@' + departureTimeEpoch;
}

function getClaimRefundRules(flightInfo) {
    let refund = 0;
    let delayInMinutes = null;
    let flightStatus = "";
    let offset = (new Date().getTimezoneOffset() / 60) * -1;
    let scheduleDepatureTime = new Date((flightInfo.filed_departuretime + offset * 60 * 60) * 1000).toISOString().slice(0, -1);
    let actualDepartureTime = (flightInfo.actualdeparturetime > 0) ? new Date((flightInfo.actualdeparturetime + offset * 60 * 60) * 1000).toISOString().slice(0, -1) : null;    
    let actualArrivalTime = (flightInfo.actualarrivaltime > 0) ? new Date((flightInfo.actualarrivaltime + offset * 60 * 60) * 1000).toISOString().slice(0, -1) : null;
    if (flightInfo.actualdeparturetime > 0 && flightInfo.filed_departuretime > 0 && flightInfo.actualdeparturetime > flightInfo.filed_departuretime){
        delayInMinutes = Math.floor((flightInfo.actualdeparturetime - flightInfo.filed_departuretime) / 60);
    }
        
    if (flightInfo.actualdeparturetime == 0) {
        flightStatus = "scheduled";
    } 
    else if (flightInfo.actualdeparturetime == -1){
        flightStatus = "cancelled";       
        refund = 300
    } 
    else if (delayInMinutes > 60){
        flightStatus = "delayed";       
        refund = 200
    } 
    else if (delayInMinutes > 30){
        flightStatus = "delayed";       
        refund = 100
    }
    else if (delayInMinutes <= 30){
        flightStatus = "on time"; 
    }

    let claimRefundRules = {
        id: flightInfo.ident + '@' + flightInfo.filed_departuretime,
        flightStatus: flightStatus,
        scheduleDepatureTime: scheduleDepatureTime,
        actualDepartureTime: actualDepartureTime,
        actualArrivalTime: actualArrivalTime,
        delayInMinutes: delayInMinutes,
        refund: refund
    }
    return claimRefundRules;
}
