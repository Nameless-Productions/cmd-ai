#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import { count } from "console";
import "dotenv/config";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
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
let cont: boolean = false;
let toolRetryCount: number = 0;
const MAX_RETRIES = 3;

let contTool: boolean = false;


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
            description: "Edit a file. ALWAYS provide the complete file content. If the file doesn't exist, it will be created. If the folder doesn't exist, create it first.",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The full path of the file"
                    },
                    content: {
                        type: "string",
                        description: "The complete new content of the file - this is REQUIRED"
                    }
                },
                required: ["path", "content"]
            }
        },

        {
            name: "create_folder",
            description: "Create a folder",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The full path of the new folder"
                    }
                },
                required: ["path"]
            }
        },
    ];
}


async function Main(){

    while (true){
        const rl = createInterface({input: process.stdin, output: process.stdout});
        let question;
        if(cont){
            if(toolRetryCount >= MAX_RETRIES) {
                console.log("Max retries reached. Moving on.");
                cont = false;
                toolRetryCount = 0;
            } else {
                question = "You ran a tool and you had to stop because of that but the tool ran succesfuly so you don't have to do it again. Now please continue where you left. This is a automated message so do not mention it.";
                cont = false;
                toolRetryCount++;
            }
        }
        
        if(!cont){
            question = await rl.question("you: ");
            rl.close();
            toolRetryCount = 0;
        }

        if(question == "" || !question || question == null) question = "Message provided by user was empty"

        if(question == "/exit"){
            console.log("\nFinal Tokens:\nInp:", finalInp, "\nOut:", finalOut);
            if(mcpProcess) mcpProcess.kill();
            break;
        }


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
                    text: `You are a coding assistant in development. Current working dir: ${process.cwd()}. 
IMPORTANT RULES:
1. When you need to perform multiple related operations (like creating a folder then editing a file in it), use multiple tools in a single response.
2. For edit_file, ALWAYS provide the complete file content - this is mandatory. Never call edit_file without the content parameter.
3. When tools return information, continue with your next action in the same response.
4. Check if folders exist before creating them using create_folder.`,
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

            let hasValidToolUse = false;

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
                                try {
                                    const contents = readdirSync(input.path).join(", ");
                                    history.push({
                                        role: "user",
                                        content: `Contents of: ${input.path} are: ${contents}`
                                    })
                                    cont = true;
                                } catch (err: any) {
                                    history.push({
                                        role: "user",
                                        content: `Error reading folder: ${err.message}`
                                    })
                                    cont = true;
                                }
                            }
                        }

                        else if(block.name == "view_file"){
                            const input = block.input as { path?: string };
                            if(input?.path){
                                try {
                                    const file = readFileSync(input.path, "utf-8");
                                    history.push({
                                        role: "user",
                                        content: `Contents of: ${input.path} are: ${file}`
                                    })
                                    cont = true
                                } catch (err: any) {
                                    history.push({
                                        role: "user",
                                        content: `Error reading file: ${err.message}`
                                    })
                                    cont = true;
                                }
                            }
                        }

                        else if(block.name == "edit_file"){
                            const input = block.input as { path?: string, content?: string };
                            if(!input?.path || !input?.content){
                                history.push({
                                    role: "user",
                                    content: `Error: edit_file requires both 'path' and 'content'. You provided - path: ${input?.path ? 'yes' : 'no'}, content: ${input?.content ? 'yes' : 'no'}. Include the complete file content.`
                                })
                                cont = true;
                            } else {
                                try {
                                    writeFileSync(input.path, input.content, "utf-8");
                                    history.push({
                                        role: "user",
                                        content: `File created/updated successfully: ${input.path}`
                                    })
                                    hasValidToolUse = true;
                                    cont = true;
                                } catch (err: any) {
                                    history.push({
                                        role: "user",
                                        content: `Error writing file: ${err.message}`
                                    })
                                    cont = true;
                                }
                            }
                        }

                        else if(block.name == "create_folder"){
                            const input = block.input as { path?: string }
                            if(input.path){
                                try {
                                    mkdirSync(input.path, { recursive: true });
                                    history.push({
                                        role: "user",
                                        content: `Folder created successfully: ${input.path}`
                                    })
                                    cont = true;
                                } catch (err: any) {
                                    history.push({
                                        role: "user",
                                        content: `Error creating folder: ${err.message}`
                                    })
                                    cont = true;
                                }
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