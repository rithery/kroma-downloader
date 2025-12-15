import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AiMetadataResult } from '../types';

// In a real scenario, this would generate metadata based on transcript or user provided context.
// Here we use the title and uploader to hallucinate a "Better" description and tags.

export const generateSmartMetadata = async (
  videoTitle: string,
  uploader: string
): Promise<AiMetadataResult> => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        throw new Error("API Key is missing");
    }

    const ai = new GoogleGenAI({ apiKey });

    // Define the schema for structured JSON output
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: "A concise, engaging 2-sentence summary of what this video might contain based on the title.",
        },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "10 high-traffic SEO tags relevant to the video topic.",
        },
        suggestedFileName: {
            type: Type.STRING,
            description: "A sanitized, SEO-friendly filename (e.g., my-video-topic.mp4)."
        }
      },
      required: ["summary", "tags", "suggestedFileName"],
    };

    const prompt = `
      I am a video archivist tool. 
      Analyze this YouTube video information:
      Title: "${videoTitle}"
      Uploader: "${uploader}"
      
      Please generate:
      1. A professional summary.
      2. Relevant tags for organizing.
      3. A clean filename.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: "You are an expert video content strategist and archivist."
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response from Gemini");
    }

    const data = JSON.parse(text) as AiMetadataResult;
    return data;

  } catch (error) {
    console.error("Gemini Error:", error);
    // Fallback if API fails or key is missing
    return {
      summary: "Could not generate AI summary. Ensure API Key is configured.",
      tags: ["video", "download", "generic"],
      suggestedFileName: "video_download.mp4"
    };
  }
};
