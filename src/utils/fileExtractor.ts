
import path from "path";
import { GoogleGenAI } from "@google/genai";
import {EXTRACT_IMPORTS} from "./prompt.js";
import type { ExtractedFile } from "../services/webhook.service.js";
const ai = new GoogleGenAI({});


export const extractImportedFiles=async(files:ExtractedFile[])=>{
    try{
       const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `${files}`,
    config: {
      thinkingConfig: {
        thinkingBudget: 0,
      },
      systemInstruction: EXTRACT_IMPORTS,
      
    }
  });
    }
    catch(err){
        return [];
    }
}


type ImportResult = {
  fileName: string;
  imports: { type: string; value: string }[];
};




type FileData = { fileName: string; content: string };
type ImportInfo = { from: string; to: string; type: string };

export function extractAllImports(files: FileData[]): ImportInfo[] {
  const importRegex = /import\s+(?:[\w*\s{},]*\s+from\s+)?["']([^"']+)["']/g;
  const sideEffectRegex = /import\s+["']([^"']+)["']/g;
  const dynamicImportRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/g;

  const allImports: ImportInfo[] = [];
  const MAX_LINES = 300;

  for (const { fileName, content } of files) {
    const dir = path.dirname(fileName);
    let truncated = content.split("\n").slice(0, MAX_LINES).join("\n");

    // ✅ Remove comments (both // and /* */)
    truncated = truncated
      // Remove /* block comments */
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Remove // line comments
      .replace(/\/\/.*$/gm, "");

    const imports: { type: string; value: string|undefined }[] = [];
    let match;

    // static ES imports
    while ((match = importRegex.exec(truncated))) {
      imports.push({ type: "static", value: match[1] });
    }
    // side-effect imports
    while ((match = sideEffectRegex.exec(truncated))) {
      imports.push({ type: "side-effect", value: match[1] });
    }
    // dynamic imports
    while ((match = dynamicImportRegex.exec(truncated))) {
      imports.push({ type: "dynamic", value: match[1] });
    }
    // commonjs requires
    while ((match = requireRegex.exec(truncated))) {
      imports.push({ type: "require", value: match[1] });
    }

    for (const imp of imports) {
      if(imp.value===undefined) continue;
      if (imp.value.startsWith("./") || imp.value.startsWith("../")) {
        const resolved = path.normalize(path.join(dir, imp.value));
        allImports.push({
          from: fileName,
          to: resolved,
          type: imp.type,
        });
      }
    }
  }

  return allImports;
}



