import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { trpcMiddleware } from "./trpc";
import { getAllCategories, getAllSubreddits, getSubredditsByCategory, standardSubreddits } from "./subredditList";
import { crawlerScheduler } from "./scheduler";
import { serpCheckService } from "./services/serpCheckService";
import { log } from "./vite";
import DotNetCrawlerService from "./services/dotnetCrawlerService";

export async function registerRoutes(app: Express): Promise<Server> {
  // Add tRPC middleware
  app.use('/api/trpc', trpcMiddleware);
  // Get all threads with filtering
  app.get("/api/threads", async (req: Request, res: Response) => {
    const { 
      subreddit, 
      intentType, 
      serpRank, 
      affiliateProgram, 
      search, 
      limit = 10, 
      offset = 0,
      sortBy,
      sortDirection
    } = req.query;
    
    try {
      const threads = await storage.getThreads({
        subreddit: subreddit as string,
        intentType: intentType as string,
        serpRank: serpRank as string,
        affiliateProgram: affiliateProgram as string,
        search: search as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        sortBy: sortBy as string,
        sortDirection: (sortDirection as 'asc' | 'desc') || 'desc'
      });
      
      const total = (await storage.getThreads({
        subreddit: subreddit as string,
        intentType: intentType as string,
        serpRank: serpRank as string,
        affiliateProgram: affiliateProgram as string,
        search: search as string
      })).length;
      
      res.json({
        threads,
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });
    } catch (error) {
      console.error("Error fetching threads:", error);
      res.status(500).json({ message: "Failed to fetch threads" });
    }
  });
  
  // Get a single thread by ID
  app.get("/api/threads/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const thread = await storage.getThreadById(id);
      
      if (!thread) {
        return res.status(404).json({ message: "Thread not found" });
      }
      
      res.json(thread);
    } catch (error) {
      console.error("Error fetching thread:", error);
      res.status(500).json({ message: "Failed to fetch thread" });
    }
  });
  
  // Get affiliate programs
  app.get("/api/affiliate-programs", async (_req: Request, res: Response) => {
    try {
      const programs = await storage.getAffiliatePrograms();
      res.json(programs);
    } catch (error) {
      console.error("Error fetching affiliate programs:", error);
      res.status(500).json({ message: "Failed to fetch affiliate programs" });
    }
  });
  
  // Get comment templates
  app.get("/api/comment-templates", async (req: Request, res: Response) => {
    try {
      const type = req.query.type as string;
      let templates;
      
      if (type) {
        templates = await storage.getCommentTemplatesByType(type);
      } else {
        templates = await storage.getCommentTemplates();
      }
      
      res.json(templates);
    } catch (error) {
      console.error("Error fetching comment templates:", error);
      res.status(500).json({ message: "Failed to fetch comment templates" });
    }
  });
  
  // Get crawl history
  app.get("/api/crawl-history", async (_req: Request, res: Response) => {
    try {
      const history = await storage.getCrawlHistory();
      res.json(history);
    } catch (error) {
      console.error("Error fetching crawl history:", error);
      res.status(500).json({ message: "Failed to fetch crawl history" });
    }
  });
  
  // Generate an affiliate comment
  app.post("/api/generate-comment", async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        threadId: z.number(),
        affiliateProgramId: z.number(),
        templateId: z.number()
      });
      
      const { threadId, affiliateProgramId, templateId } = schema.parse(req.body);
      
      // Get the thread, affiliate program, and template
      const thread = await storage.getThreadById(threadId);
      const program = await storage.getAffiliateProgramById(affiliateProgramId);
      const template = await storage.getCommentTemplateById(templateId);
      
      if (!thread || !program || !template) {
        return res.status(404).json({ 
          message: `${!thread ? 'Thread' : !program ? 'Affiliate program' : 'Template'} not found` 
        });
      }
      
      // Generate a comment by replacing placeholders in the template
      let comment = template.template;
      
      // Replace common placeholders
      comment = comment.replaceAll('{{program}}', program.name);
      comment = comment.replaceAll('{{link}}', program.link);
      comment = comment.replaceAll('{{promo_code}}', program.promoCode || '');
      
      // Replace specific placeholders with mock content
      // In a real implementation, these would be generated by an AI
      comment = comment.replaceAll('{{benefit}}', 'it has specialized templates for blog posts, articles, and social media content');
      comment = comment.replaceAll('{{feature}}', 'the Boss Mode plan');
      comment = comment.replaceAll('{{advantage}}', 'write long-form content with AI continuing your thoughts');
      comment = comment.replaceAll('{{reason}}', 'of its versatility and user-friendly interface');
      comment = comment.replaceAll('{{use_case}}', 'blog posts and social media content');
      comment = comment.replaceAll('{{use_case_1}}', 'Blog post outlines');
      comment = comment.replaceAll('{{use_case_2}}', 'Full blog articles');
      comment = comment.replaceAll('{{use_case_3}}', 'Social media captions');
      comment = comment.replaceAll('{{limitation}}', 'the depth of long-form content generation');
      comment = comment.replaceAll('{{drawback}}', 'requires more editing');
      comment = comment.replaceAll('{{improvement}}', 'increased by 200%');
      comment = comment.replaceAll('{{advantage_1}}', 'Specialized templates for your exact content needs');
      comment = comment.replaceAll('{{advantage_2}}', 'High-quality output requiring minimal editing');
      comment = comment.replaceAll('{{advantage_3}}', 'Excellent customer support and regular updates');
      comment = comment.replaceAll('{{plan}}', 'Creator');
      comment = comment.replaceAll('{{price}}', '$49');
      comment = comment.replaceAll('{{result}}', 'have seen a 70% reduction in content creation time');
      comment = comment.replaceAll('{{discount}}', '20% off your first month');
      
      res.json({ comment });
    } catch (error) {
      console.error("Error generating comment:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to generate comment" });
    }
  });
  
  // Run crawler
  app.post("/api/run-crawler", async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        subreddits: z.array(z.string()).optional()
      });
      
      // Parse request body and handle missing or empty subreddits array
      const { subreddits } = schema.parse(req.body);
      
      // If no subreddits are provided or the array is empty, use all standard subreddits
      const subredditList = subreddits && subreddits.length > 0 
        ? subreddits 
        : getAllSubreddits();
      
      log(`Starting crawler for subreddits: ${subredditList.join(', ')}`, 'routes');
      
      // Use DotNetCrawlerService instead of direct storage access
      const crawlHistory = await DotNetCrawlerService.runCrawler(subredditList);
      
      // Access ID and threadCount properties safely with optional chaining
      const historyId = (crawlHistory as any).id || 'unknown';
      const threadCount = (crawlHistory as any).threadCount || 0;
      
      log(`Crawler completed with ID: ${historyId}, threads: ${threadCount}`, 'routes');
      res.json(crawlHistory);
    } catch (error) {
      console.error("Error running crawler:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to run crawler" });
    }
  });

  // Get opportunities with filtering
  app.get("/api/opportunities", async (req: Request, res: Response) => {
    const { 
      threadId, 
      intent, 
      score,
      scoreMin,
      scoreMax,
      serpMatch,
      action,
      limit = 10, 
      offset = 0,
      sortBy,
      sortDirection
    } = req.query;
    
    try {
      const opportunities = await storage.getOpportunities({
        threadId: threadId ? parseInt(threadId as string) : undefined,
        intent: intent as string,
        score: score ? parseInt(score as string) : undefined,
        scoreMin: scoreMin ? parseInt(scoreMin as string) : undefined,
        scoreMax: scoreMax ? parseInt(scoreMax as string) : undefined,
        serpMatch: serpMatch ? (serpMatch === 'true') : undefined,
        action: action as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        sortBy: sortBy as string,
        sortDirection: (sortDirection as 'asc' | 'desc') || 'desc'
      });
      
      const total = (await storage.getOpportunities({
        threadId: threadId ? parseInt(threadId as string) : undefined,
        intent: intent as string,
        score: score ? parseInt(score as string) : undefined,
        scoreMin: scoreMin ? parseInt(scoreMin as string) : undefined,
        scoreMax: scoreMax ? parseInt(scoreMax as string) : undefined,
        serpMatch: serpMatch ? (serpMatch === 'true') : undefined,
        action: action as string
      })).length;
      
      res.json({
        opportunities,
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });
    } catch (error) {
      console.error("Error fetching opportunities:", error);
      res.status(500).json({ message: "Failed to fetch opportunities" });
    }
  });
  
  // Get opportunity by ID
  app.get("/api/opportunities/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const opportunity = await storage.getOpportunityById(id);
      
      if (!opportunity) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      
      res.json(opportunity);
    } catch (error) {
      console.error("Error fetching opportunity:", error);
      res.status(500).json({ message: "Failed to fetch opportunity" });
    }
  });
  
  // Get opportunities by thread ID
  app.get("/api/threads/:threadId/opportunities", async (req: Request, res: Response) => {
    try {
      const threadId = parseInt(req.params.threadId);
      const opportunities = await storage.getOpportunitiesByThreadId(threadId);
      
      res.json(opportunities);
    } catch (error) {
      console.error("Error fetching opportunities by thread ID:", error);
      res.status(500).json({ message: "Failed to fetch opportunities" });
    }
  });

  // Create an opportunity
  app.post("/api/opportunities", async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        threadId: z.number(),
        score: z.number(),
        intent: z.string().optional(),
        matchedProgramIds: z.array(z.number()),
        serpMatch: z.boolean(),
        action: z.string()
      });
      
      const opportunityData = schema.parse(req.body);
      
      const opportunity = await storage.createOpportunity(opportunityData);
      res.status(201).json(opportunity);
    } catch (error) {
      console.error("Error creating opportunity:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create opportunity" });
    }
  });
  
  // Update an opportunity
  app.patch("/api/opportunities/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({
        score: z.number().optional(),
        intent: z.string().optional(),
        matchedProgramIds: z.array(z.number()).optional(),
        serpMatch: z.boolean().optional(),
        action: z.string().optional()
      });
      
      const opportunityData = schema.parse(req.body);
      
      const opportunity = await storage.updateOpportunity(id, opportunityData);
      
      if (!opportunity) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      
      res.json(opportunity);
    } catch (error) {
      console.error("Error updating opportunity:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update opportunity" });
    }
  });
  
  // Delete an opportunity
  app.delete("/api/opportunities/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteOpportunity(id);
      
      if (!success) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting opportunity:", error);
      res.status(500).json({ message: "Failed to delete opportunity" });
    }
  });
  
  // Get SERP results
  app.get("/api/serp-results", async (_req: Request, res: Response) => {
    try {
      const serpResults = await storage.getSerpResults();
      res.json(serpResults);
    } catch (error) {
      console.error("Error fetching SERP results:", error);
      res.status(500).json({ message: "Failed to fetch SERP results" });
    }
  });
  
  // Get SERP result by ID
  app.get("/api/serp-results/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const serpResult = await storage.getSerpResultById(id);
      
      if (!serpResult) {
        return res.status(404).json({ message: "SERP result not found" });
      }
      
      res.json(serpResult);
    } catch (error) {
      console.error("Error fetching SERP result:", error);
      res.status(500).json({ message: "Failed to fetch SERP result" });
    }
  });
  
  // Get SERP results by thread ID
  app.get("/api/threads/:threadId/serp-results", async (req: Request, res: Response) => {
    try {
      const threadId = parseInt(req.params.threadId);
      const serpResults = await storage.getSerpResultsByThreadId(threadId);
      
      res.json(serpResults);
    } catch (error) {
      console.error("Error fetching SERP results by thread ID:", error);
      res.status(500).json({ message: "Failed to fetch SERP results" });
    }
  });
  
  // Create a SERP result
  app.post("/api/serp-results", async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        threadId: z.number(),
        query: z.string(),
        position: z.number(),
        isRanked: z.boolean()
      });
      
      const serpResultData = schema.parse(req.body);
      
      const serpResult = await storage.createSerpResult(serpResultData);
      res.status(201).json(serpResult);
    } catch (error) {
      console.error("Error creating SERP result:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create SERP result" });
    }
  });
  
  // Update a SERP result
  app.patch("/api/serp-results/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({
        query: z.string().optional(),
        position: z.number().optional(),
        isRanked: z.boolean().optional()
      });
      
      const serpResultData = schema.parse(req.body);
      
      const serpResult = await storage.updateSerpResult(id, serpResultData);
      
      if (!serpResult) {
        return res.status(404).json({ message: "SERP result not found" });
      }
      
      res.json(serpResult);
    } catch (error) {
      console.error("Error updating SERP result:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update SERP result" });
    }
  });
  
  // Delete a SERP result
  app.delete("/api/serp-results/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteSerpResult(id);
      
      if (!success) {
        return res.status(404).json({ message: "SERP result not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting SERP result:", error);
      res.status(500).json({ message: "Failed to delete SERP result" });
    }
  });
  
  // Test endpoint for directly testing the dotnetCrawlerService
  app.post("/api/test-dotnet-crawler", async (req: Request, res: Response) => {
    try {
      const subreddits = req.body.subreddits || ['programming', 'javascript'];
      const result = await DotNetCrawlerService.runCrawler(subreddits);
      res.status(200).json({ message: 'DotNet crawler test successful', result });
    } catch (error) {
      console.error('Error testing dotnet crawler:', error);
      res.status(500).json({ error: 'Failed to test dotnet crawler', details: error.message });
    }
  });
  
  // Refresh opportunities
  app.post("/api/refresh-opportunities", async (_req: Request, res: Response) => {
    try {
      const count = await storage.refreshOpportunities();
      res.json({ count, message: `Refreshed ${count} opportunities` });
    } catch (error) {
      console.error("Error refreshing opportunities:", error);
      res.status(500).json({ message: "Failed to refresh opportunities" });
    }
  });

  // Get all subreddit categories
  app.get("/api/subreddit-categories", async (_req: Request, res: Response) => {
    try {
      const categories = getAllCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching subreddit categories:", error);
      res.status(500).json({ message: "Failed to fetch subreddit categories" });
    }
  });

  // Get subreddits by category
  app.get("/api/subreddit-categories/:category", async (req: Request, res: Response) => {
    try {
      const category = req.params.category;
      const subreddits = getSubredditsByCategory(category);
      
      if (!subreddits || subreddits.length === 0) {
        return res.status(404).json({ message: "Category not found" });
      }
      
      res.json(subreddits);
    } catch (error) {
      console.error("Error fetching subreddits by category:", error);
      res.status(500).json({ message: "Failed to fetch subreddits" });
    }
  });

  // Get all subreddits 
  app.get("/api/subreddits", async (_req: Request, res: Response) => {
    try {
      const subreddits = getAllSubreddits();
      res.json(subreddits);
    } catch (error) {
      console.error("Error fetching all subreddits:", error);
      res.status(500).json({ message: "Failed to fetch subreddits" });
    }
  });

  // Start the crawler scheduler
  app.post("/api/scheduler/start", async (_req: Request, res: Response) => {
    try {
      const result = crawlerScheduler.startCrawlerJob();
      if (result) {
        res.json({ message: "Crawler job scheduled successfully" });
      } else {
        res.status(400).json({ message: "Crawler job is already running" });
      }
    } catch (error) {
      console.error("Error starting crawler job:", error);
      res.status(500).json({ message: "Failed to start crawler job" });
    }
  });

  // Stop the crawler scheduler
  app.post("/api/scheduler/stop", async (_req: Request, res: Response) => {
    try {
      const result = crawlerScheduler.stopCrawlerJob();
      if (result) {
        res.json({ message: "Crawler job stopped successfully" });
      } else {
        res.status(400).json({ message: "No crawler job is running" });
      }
    } catch (error) {
      console.error("Error stopping crawler job:", error);
      res.status(500).json({ message: "Failed to stop crawler job" });
    }
  });

  // Get the crawler scheduler status
  app.get("/api/scheduler/status", async (_req: Request, res: Response) => {
    try {
      const isRunning = crawlerScheduler.isCrawlerJobRunning();
      res.json({ 
        isRunning, 
        status: isRunning ? "Crawler job is running" : "No crawler job is running" 
      });
    } catch (error) {
      console.error("Error getting crawler job status:", error);
      res.status(500).json({ message: "Failed to get crawler job status" });
    }
  });

  // Run the crawler immediately
  app.post("/api/scheduler/run-now", async (_req: Request, res: Response) => {
    try {
      await crawlerScheduler.runCrawlerNow();
      res.json({ message: "Crawler job triggered successfully" });
    } catch (error) {
      console.error("Error triggering crawler job:", error);
      res.status(500).json({ message: "Failed to trigger crawler job" });
    }
  });

  // Check SERP position for a thread
  app.post("/api/check-serp-position", async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        threadId: z.number(),
        query: z.string().optional()
      });
      
      const serpCheckRequest = schema.parse(req.body);
      
      const response = await serpCheckService.checkSerpPosition(serpCheckRequest);
      res.json(response);
    } catch (error) {
      console.error("Error checking SERP position:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to check SERP position" });
    }
  });

  // Initialize the HTTP server
  const httpServer = createServer(app);

  // Start the crawler scheduler by default
  crawlerScheduler.startCrawlerJob();
  console.log("Crawler scheduler started by default");

  return httpServer;
}
