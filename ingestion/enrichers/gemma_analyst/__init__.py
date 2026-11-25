"""
Gemma Analyst Module — Senior Budget Analyst LLM Integration
Provides structured 6-job analysis per budget record using a local Gemma GGUF model.
Gracefully degrades (skips Gemma stage) if llama-cpp-python is not installed.
"""
