// lambda code
// Section 1
import mysql from "mysql2/promise";
import {
  DynamoDBClient,
  BatchGetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });

// Section 2
export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const pathParams = event.pathParameters || {};
  const queryParams = event.queryStringParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};

  // Section 3
  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET, PUT, DELETE",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With",
        "Access-Control-Allow-Credentials": true,
      },
      body: "",
    };
  }

  // Section 4
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    // [1] GET /event/{event_id}
    if (method === "GET" && path.startsWith("/event/")) {
      const eventId = pathParams.event_id;
      console.log("Looking for event_id", eventId);

      const [rows] = await conn.execute(
        "SELECT * FROM events WHERE event_id = ?",
        [eventId]
      );

      if (rows.length === 0) {
        return json({ message: "Event not found" }, 404);
      }

      return json(rows[0]);
    }

    // [2] GET /stats/{event_id}
    if (method === "GET" && path.startsWith("/stats/")) {
      const eventId = pathParams.event_id;
      console.log("Looking for stats for event_id", eventId);

      const responses = ["Yes", "No"];
      const keys = responses.map((r) => ({
        pk: { S: `EVENT#${eventId}` },
        sk: { S: `RESPONSE#${r}` },
      }));

      const result = await dynamo.send(
        new BatchGetItemCommand({
          RequestItems: { "event-rsvp-responses": { Keys: keys } },
        })
      );

      const items = result.Responses?.["event-rsvp-responses"] || [];
      const counts = { Yes: 0, No: 0 };

      for (const item of items) {
        const key = item.sk.S.split("#")[1];
        counts[key] = Number(item.count?.N || 0);
      }

      return json(counts);
    }

    // [3] POST /rsvp
    if (method === "POST" && path === "/rsvp") {
      const { event_id, full_name, email, response } = body;
      console.log("RSVP request:", { event_id, full_name, email, response });

      if (!event_id || !full_name || !email || !response) {
        return json({ message: "Missing required fields" }, 400);
      }

      const now = Date.now();

      try {
        await dynamo.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              {
                Put: {
                  TableName: "event-rsvp-responses",
                  Item: {
                    pk: { S: `EVENT#${event_id}` },
                    sk: { S: `RESPONDENT#${email}` },
                    full_name: { S: full_name },
                    response: { S: response },
                    created_at: { N: String(now) },
                  },
                  ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
                }
              },
              {
                Update: {
                  TableName: "event-rsvp-responses",
                  Key: {
                    pk: { S: `EVENT#${event_id}` },
                    sk: { S: `RESPONSE#${response}` },
                  },
                  UpdateExpression: "ADD #count :one",
                  ExpressionAttributeNames: {
                    "#count": "count",
                  },
                  ExpressionAttributeValues: {
                    ":one": { N: "1" },
                  },
                },
              },
            ],
          })
        );

        return json({ message: "RSVP recorded!" }, 200);
      } catch (error) {
        if (
          error.name === "TransactionCanceledException" ||
          error.name === "ConditionalCheckFailedException"
        ) {
          return json(
            {
              message:
                "You have already RSVP'd for this event with this email!",
              code: "DUPLICATE_RSVP",
            },
            409
          );
        }

        console.log("DynamoDB error:", error);
        return json({ error: error.message }, 500);
      }
    }

    // [4] GET /attendees/{event_id}
    if (method === "GET" && path.startsWith("/attendees/")) {
      const eventId = pathParams.event_id;
      const responseType = queryParams.response; // optional filter

      let keyCondition = "pk = :pk AND begins_with(sk, :prefix)";
      let expressionValues = {
        ":pk": { S: `EVENT#${eventId}` },
        ":prefix": { S: "RESPONDENT#" }
      };

      // filter by response type if provided
      if (responseType) {
        keyCondition = "pk = :pk AND begins_with(sk, :prefix)";
        expressionValues[":prefix"] = { S: `RESPONDENT#` };
      }

      const result = await dynamo.send(
        new QueryCommand({
          TableName: "event-rsvp-responses",
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: expressionValues,
        }));

      let attendees = result.Items.map((item) => ({
        full_name: item.full_name?.S,
        email: item.email?.S,
        response: item.response?.S,
        timestamp: parseInt(item.timestamp?.N)
      }));

      // filter by response type if specified
      if (responseType) {
        attendees = attendees.filter((attendee) => attendee.response === responseType);
      }

      return json(attendees);
    }

    // [5] GET /events
    if (method === "GET" && path === "/events") {
      console.log("Getting all events");
      const [rows] = await conn.execute(`
        SELECT * FROM events
        ORDER BY start_at ASC
      `);
      return json(rows);
    }

    // fall back
    return json({ message: "Route Not Found" }, 404);
  } catch (error) {
    console.log("Error:", error);
    return json({ error: error.message }, 500);
  } finally {
    if (conn) await conn.end();
  }
};

// helper function for consistent JSON responses
function json(data, statusCode = 200) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET, PUT, DELETE",
      "Access-Control-Allow-Headers":
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(data),
  };
}
