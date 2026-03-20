#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline/promises";

const client = new Anthropic({
    apiKey: process.env.API
});

const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();


let mcpProcess: any = null;
let history: Array<{role: "user" | "assistant", content: string}> = []
let finalInp: number = 0;
let finalOut: number = 0;


function getAvailableTools() {
    return [
        {
            name: "make_test_file",
            description: "Makes a test file",
            input_schema: {
                type: "object",
                properties: {
                    content: {
                        type: "string",
                        description: "The content of the test file"
                    }
                },
                required: ["content"]
            }
        },

        {
            name: "list_things",
            description: "Lists things in the provided folder and puts it in the message history",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The full path of the folder"
                    }
                },
                required: ["path"]
            }
        },

        {
            name: "view_file",
            description: "View the contents of the file (only works with UTF-8 encoding)",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The full path of the file"
                    }
                },
                required: ["path"]
            }
        },

        {
            name: "edit_file",
            description: "Edit a file. If the file doesn't exists then it will create it",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The full path of the file"
                    },
                    content: {
                        type: "string",
                        description: "The new content of the file"
                    }
                },
                required: ["path", "content"]
            }
        },
    ];
}


async function Main(){

    while (true){
        const rl = createInterface({input: process.stdin, output: process.stdout});
        let question = await rl.question("Input: ");
        rl.close();

        if(question == "/exit"){
            console.log("\nFinal Tokens:\nInp:", finalInp, "\nOut:", finalOut);
            if(mcpProcess) mcpProcess.kill();
            break;
        }

        if(!question || question === "" || question === null) question = "You probally just ran a tool and please continue the conversation exactly where you left. if the tool has a response then you should be able to see it in the message history. Do not say anything about this message because it's a automatic message.";

        history.push({
            role: "user",
            content: question
        });

        const stream = client.messages.stream({
            model: "claude-haiku-4-5",
            max_tokens: 1024,
            messages: history,
            tools: getAvailableTools() as any,
            system: [
                {
                    type: "text",
                    text: `You are a coding assistant in development. Here are some information: Currect working dir: ${process.cwd()}`,
                }
            ]
        })

        let fullText = "";

        stream.on("text", (txt) => {
            process.stdout.write(txt);
            fullText += txt;
        });
        stream.on("message", (msg) => {
            console.log("\nTokens:\nInp:", msg.usage.input_tokens, "\nOut:", msg.usage.output_tokens);
            finalInp = finalInp + msg.usage.input_tokens;
            finalOut = finalOut + msg.usage.output_tokens;

            if(msg.content){
                for(const block of msg.content){
                    if(block.type == "tool_use"){
                        console.log(block.name, "\n", block.input);
                        if(block.name == "make_test_file"){
                            const input = block.input as { content?: string };
                            if(input?.content){
                                writeFileSync(`${process.cwd()}/test.txt`, input.content);
                            }
                        }
                        else if(block.name == "list_things"){
                            const input = block.input as { path?: string };
                            if(input?.path){
                                history.push({
                                    role: "user",
                                    content: `Contents of: ${input.path} are: ${readdirSync(input.path).join(", ")}`
                                })
                                console.log("Press enter to continue the conversation");
                            }
                        }

                        else if(block.name == "view_file"){
                            const input = block.input as { path?: string };
                            if(input?.path){
                                const file = readFileSync(input.path, "utf-8");
                                history.push({
                                    role: "user",
                                    content: `Contents of: ${input.path} are: ${file}`
                                })
                                console.log("Press enter to continue the conversation");
                            }
                        }

                        else if(block.name == "edit_file"){
                            const input = block.input as { path?: string, content?: string };
                            if(input?.path && input?.content){
                                writeFileSync(input.path, input.content, "utf-8");
                            }
                        }
                    }
                }
            }
        });
        stream.on("error", (err) => {
            console.error("Error: ", err);
            process.exit(1);
        });
        
        await stream.finalMessage();
        
        history.push({
            role: "assistant",
            content: fullText
        })
    }
}

Main();