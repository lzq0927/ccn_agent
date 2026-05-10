"""
FastAPI REST API + WebSocket server for frontend dashboard.
Provides real-time updates and access to all dashboard API endpoints.
"""

import sys
import json
import logging
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Set, Any, Union
from collections import defaultdict

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Import managers
from iteration_state.manager import IterationStateManager
from iteration_state.state import IterationState, DataGenStatus, PerceptionStatus, EvalStatus
from case_library.manager import CaseLibraryManager
from case_library.models import FaultCase, FaultType, KPIMetrics

# Import agents for perception
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.fault_perception.data_types import PerceptionMode, ConfidenceLevel

logger = logging.getLogger(__name__)

# =============================================================================
# Pydantic Models for Request/Response
# =============================================================================

class PerceptionInputRequest(BaseModel):
    case_id: Optional[str] = None
    kpi_records: List[Dict] = Field(default_factory=list)
    topology: Optional[Dict] = Field(default_factory=dict)
    business_flows: List[Dict] = Field(default_factory=list)
    fault_config: Optional[Dict] = None
    is_normal_scenario: bool = False


class FaultCaseCreate(BaseModel):
    case_id: str
    fault_type: str = "unknown"
    perception_mode: str = "auto"
    accuracy: float = 0.0
    confidence: float = 0.5
    tags: List[str] = Field(default_factory=list)
    affected_ne_ids: List[str] = Field(default_factory=list)
    affected_link_count: int = 0
    kpi_metrics: Optional[Dict] = None
    reasoning_trace: List[Dict] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    iteration: int = 0


class WSMessage(BaseModel):
    type: str
    data: Dict


# =============================================================================
# WebSocket Connection Manager
# =============================================================================

class ConnectionManager:
    """Manages WebSocket connections for real-time updates."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.active_connections.append(websocket)
        logger.info(f"[WS] Client connected. Total: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
        logger.info(f"[WS] Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: Dict):
        """Broadcast message to all connected clients."""
        async with self._lock:
            disconnected = []
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    disconnected.append(connection)

            # Clean up disconnected
            for conn in disconnected:
                if conn in self.active_connections:
                    self.active_connections.remove(conn)


# Global connection manager
manager = ConnectionManager()


# =============================================================================
# FastAPI Application
# =============================================================================

app = FastAPI(
    title="CCN Fault Perception API",
    description="REST API + WebSocket server for the Cloud Core Network fault perception system",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
iteration_manager: Optional[IterationStateManager] = None
case_library_manager: Optional[CaseLibraryManager] = None
perception_agent: Optional[FaultPerceptionAgent] = None


def get_iteration_manager() -> IterationStateManager:
    global iteration_manager
    if iteration_manager is None:
        iteration_manager = IterationStateManager("iteration_state/states.json")
    return iteration_manager


def get_case_library_manager() -> CaseLibraryManager:
    global case_library_manager
    if case_library_manager is None:
        case_library_manager = CaseLibraryManager("case_library/cases.json")
    return case_library_manager


def get_perception_agent() -> FaultPerceptionAgent:
    global perception_agent
    if perception_agent is None:
        # Get historical cases for the agent
        case_mgr = get_case_library_manager()
        historical_cases = [c.to_dict() for c in case_mgr.get_all_cases()]
        perception_agent = FaultPerceptionAgent(
            config={
                "historical_cases": historical_cases,
                "confidence_threshold_high": 0.85,
                "confidence_threshold_medium": 0.5,
                "enable_self_optimization": True
            }
        )
    return perception_agent


# =============================================================================
# Helper: Broadcast updates
# =============================================================================

async def broadcast_update(event_type: str, data: Dict):
    """Send update to all WebSocket clients."""
    await manager.broadcast({
        "type": event_type,
        "data": data,
        "timestamp": datetime.now().isoformat()
    })


# =============================================================================
# Dashboard Summary Endpoint
# =============================================================================

@app.get("/api/dashboard/summary")
async def get_dashboard_summary():
    """
    Get dashboard summary with key metrics across all components.
    """
    iter_mgr = get_iteration_manager()
    case_mgr = get_case_library_manager()

    # Get iteration states
    iterations = iter_mgr.get_all_iterations()
    current_state = iter_mgr.get_current_state()

    # Calculate summary metrics
    total_cases = case_mgr.get_case_count()
    stats = case_mgr.get_statistics()

    # Get progress
    progress = iter_mgr.get_progress()

    # Agent status from current iteration
    agent_status = {
        "data_generation": "idle",
        "perception": "idle",
        "evaluation": "idle"
    }

    if current_state:
        agent_status = {
            "data_generation": current_state.data_gen_status.value,
            "perception": current_state.perception_status.value,
            "evaluation": current_state.eval_status.value
        }

    return {
        "system_status": "running" if current_state and not current_state.completed else "idle",
        "current_iteration": current_state.iteration if current_state else 0,
        "total_iterations": current_state.total_iterations if current_state else 0,
        "progress_percentage": current_state.get_progress_percentage() if current_state else 0,
        "agent_status": agent_status,
        "case_library": {
            "total_cases": total_cases,
            "avg_accuracy": stats.get("avg_accuracy", 0.0),
            "avg_confidence": stats.get("avg_confidence", 0.0),
            "by_fault_type": stats.get("by_fault_type", {})
        },
        "iteration_summary": {
            "total": len(iterations),
            "completed": sum(1 for i in iterations if i.completed),
            "in_progress": sum(1 for i in iterations if i.is_active())
        }
    }


# =============================================================================
# Iteration Endpoints
# =============================================================================

@app.get("/api/iterations")
async def list_iterations(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """Get all iteration states."""
    iter_mgr = get_iteration_manager()
    iterations = iter_mgr.get_all_iterations()

    # Apply pagination
    total = len(iterations)
    iterations = iterations[offset:offset + limit]

    return {
        "iterations": [i.to_dict() for i in iterations],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@app.get("/api/iterations/{iteration_id}")
async def get_iteration(iteration_id: int):
    """Get iteration state by ID."""
    iter_mgr = get_iteration_manager()
    state = iter_mgr.get_iteration(iteration_id)

    if not state:
        raise HTTPException(status_code=404, detail=f"Iteration {iteration_id} not found")

    result = state.to_dict()

    # Also get cases for this iteration
    case_mgr = get_case_library_manager()
    iteration_cases = [c for c in case_mgr.get_all_cases() if c.iteration == iteration_id]
    result["cases"] = [c.to_dict() for c in iteration_cases]

    return result


# =============================================================================
# Case Endpoints
# =============================================================================

@app.get("/api/cases")
async def list_cases(
    iteration: Optional[int] = None,
    fault_type: Optional[str] = None,
    perception_mode: Optional[str] = None,
    min_accuracy: Optional[float] = None,
    max_accuracy: Optional[float] = None,
    min_confidence: Optional[float] = None,
    max_confidence: Optional[float] = None,
    tags: Optional[str] = None,  # comma-separated
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0)
):
    """List cases with optional filters."""
    case_mgr = get_case_library_manager()

    # Parse fault type
    ft = FaultType(fault_type) if fault_type else None

    # Parse tags
    tag_set = set(tags.split(",")) if tags else None

    # Search cases
    cases = case_mgr.search_cases(
        fault_type=ft,
        perception_mode=perception_mode,
        min_accuracy=min_accuracy,
        max_accuracy=max_accuracy,
        min_confidence=min_confidence,
        max_confidence=max_confidence,
        tags=tag_set,
        limit=limit + offset
    )

    # Filter by iteration if specified
    if iteration is not None:
        cases = [c for c in cases if c.iteration == iteration]

    # Apply offset
    cases = cases[offset:offset + limit]

    return {
        "cases": [c.to_dict() for c in cases],
        "total": case_mgr.get_case_count(),
        "limit": limit,
        "offset": offset
    }


@app.get("/api/cases/{case_id}")
async def get_case(case_id: str):
    """Get case by ID."""
    case_mgr = get_case_library_manager()
    case = case_mgr.get_case(case_id)

    if not case:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    return case.to_dict()


@app.get("/api/cases/{case_id}/reasoning")
async def get_case_reasoning(case_id: str):
    """Get detailed reasoning trace for a case."""
    case_mgr = get_case_library_manager()
    case = case_mgr.get_case(case_id)

    if not case:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    return {
        "case_id": case_id,
        "reasoning_trace": case.reasoning_trace,
        "recommendations": case.recommendations,
        "kpi_metrics": {
            "avg_success_rate": case.kpi_metrics.avg_success_rate,
            "min_success_rate": case.kpi_metrics.min_success_rate,
            "affected_flows": case.kpi_metrics.affected_flows,
            "total_flows": case.kpi_metrics.total_flows
        } if case.kpi_metrics else None
    }


@app.post("/api/cases")
async def create_case(case_data: FaultCaseCreate):
    """Create a new fault case manually."""
    case_mgr = get_case_library_manager()

    # Check if case_id already exists
    if case_mgr.get_case(case_data.case_id):
        raise HTTPException(status_code=409, detail=f"Case {case_data.case_id} already exists")

    # Parse fault type
    try:
        fault_type = FaultType(case_data.fault_type)
    except ValueError:
        fault_type = FaultType.UNKNOWN

    # Build KPI metrics
    kpi_metrics = KPIMetrics()
    if case_data.kpi_metrics:
        kpi_metrics = KPIMetrics(
            avg_success_rate=case_data.kpi_metrics.get("avg_success_rate", 1.0),
            min_success_rate=case_data.kpi_metrics.get("min_success_rate", 1.0),
            affected_flows=case_data.kpi_metrics.get("affected_flows", 0),
            total_flows=case_data.kpi_metrics.get("total_flows", 0)
        )

    # Create case
    case = FaultCase(
        case_id=case_data.case_id,
        fault_type=fault_type,
        perception_mode=case_data.perception_mode,
        accuracy=case_data.accuracy,
        confidence=case_data.confidence,
        tags=set(case_data.tags),
        affected_ne_ids=set(case_data.affected_ne_ids),
        affected_link_count=case_data.affected_link_count,
        kpi_metrics=kpi_metrics,
        reasoning_trace=case_data.reasoning_trace,
        recommendations=case_data.recommendations,
        iteration=case_data.iteration
    )

    success = case_mgr.add_case(case)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to add case")

    # Broadcast update
    await broadcast_update("case_created", {"case_id": case_data.case_id})

    return {"success": True, "case": case.to_dict()}


# =============================================================================
# Skills Endpoints
# =============================================================================

@app.get("/api/skills/diffs")
async def get_skill_diffs(
    skill_name: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100)
):
    """Get skill update history/diffs."""
    iter_mgr = get_iteration_manager()
    iterations = iter_mgr.get_all_iterations()

    # Collect skill updates
    all_updates = []
    for iteration in iterations:
        for skill, update in iteration.skill_updates.items():
            if skill_name is None or skill == skill_name:
                all_updates.append({
                    "skill_name": skill,
                    "iteration": iteration.iteration,
                    **update
                })

    # Sort by timestamp descending
    all_updates.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    return {
        "updates": all_updates[:limit],
        "total": len(all_updates)
    }


# =============================================================================
# Perception Endpoints
# =============================================================================

@app.get("/api/perception/current")
async def get_current_perception():
    """Get current perception agent status and any in-progress state."""
    agent = get_perception_agent()
    status = agent.get_status()

    # Get current iteration perception status
    iter_mgr = get_iteration_manager()
    current_state = iter_mgr.get_current_state()

    perception_state = "idle"
    if current_state:
        perception_state = current_state.perception_status.value

    return {
        "agent_status": status,
        "perception_status": perception_state,
        "current_case_id": status.get("case_id")
    }


@app.post("/api/perception/input")
async def submit_perception_input(
    input_data: PerceptionInputRequest,
    background_tasks: BackgroundTasks
):
    """
    Submit perception input for processing.
    This triggers the perception workflow on the provided KPI data.
    """
    # Update status
    iter_mgr = get_iteration_manager()
    current_state = iter_mgr.get_current_state()
    if current_state:
        iter_mgr.update_perception_status(PerceptionStatus.RUNNING)

    await broadcast_update("perception_started", {
        "case_id": input_data.case_id or "pending"
    })

    # Process in background to not block
    async def process_perception():
        try:
            agent = get_perception_agent()

            # Build input dict for agent
            input_dict = {
                "case_id": input_data.case_id or f"case_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                "kpi_records": input_data.kpi_records,
                "topology": input_data.topology or {},
                "business_flows": input_data.business_flows,
                "fault_config": input_data.fault_config,
                "is_normal_scenario": input_data.is_normal_scenario
            }

            result = agent.run(input_dict)

            if result.get("success"):
                # Update iteration state
                iter_mgr = get_iteration_manager()
                iter_mgr.update_perception_status(PerceptionStatus.COMPLETED)

                await broadcast_update("perception_completed", {
                    "case_id": result.get("output", {}).get("case_id"),
                    "output": result.get("output"),
                    "metrics": result.get("metrics")
                })
            else:
                iter_mgr.update_perception_status(PerceptionStatus.FAILED)
                await broadcast_update("perception_failed", {
                    "error": result.get("error", "Unknown error")
                })

        except Exception as e:
            logger.error(f"Perception processing error: {e}", exc_info=True)
            try:
                iter_mgr.update_perception_status(PerceptionStatus.FAILED)
            except Exception:
                pass
            await broadcast_update("perception_failed", {"error": str(e)})

    background_tasks.add_task(process_perception)

    return {
        "status": "accepted",
        "message": "Perception input queued for processing",
        "case_id": input_data.case_id
    }


@app.get("/api/perception/history")
async def get_perception_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Get historical perception records."""
    case_mgr = get_case_library_manager()
    all_cases = case_mgr.get_all_cases()

    # Sort by created_at descending
    all_cases.sort(key=lambda c: c.created_at, reverse=True)

    total = len(all_cases)
    cases = all_cases[offset:offset + limit]

    return {
        "cases": [c.to_dict() for c in cases],
        "total": total,
        "limit": limit,
        "offset": offset
    }


# =============================================================================
# Evaluator Endpoints
# =============================================================================

@app.get("/api/evaluator/suggestions")
async def get_optimization_suggestions(
    limit: int = Query(10, ge=1, le=50)
):
    """Get current optimization suggestions from evaluator."""
    iter_mgr = get_iteration_manager()
    iterations = iter_mgr.get_all_iterations()

    # Collect suggestions from all iterations
    suggestions = []
    for iteration in iterations:
        for skill_name, update in iteration.skill_updates.items():
            suggestions.append({
                "skill_name": skill_name,
                "iteration": iteration.iteration,
                "description": update.get("description", ""),
                "timestamp": update.get("timestamp")
            })

    # Sort by timestamp
    suggestions.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    return {
        "suggestions": suggestions[:limit],
        "total": len(suggestions)
    }


# =============================================================================
# WebSocket Endpoint
# =============================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.
    Clients connect here to receive live updates about:
    - Iteration progress
    - Perception results
    - Case updates
    """
    await manager.connect(websocket)

    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connected",
            "data": {"message": "WebSocket connected"},
            "timestamp": datetime.now().isoformat()
        })

        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for messages (with timeout to allow checking connection)
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=60.0
                )

                # Handle ping/pong
                if data == "ping":
                    await websocket.send_text("pong")
                    continue

                # Parse and handle message
                try:
                    message = json.loads(data)
                    msg_type = message.get("type", "")

                    if msg_type == "subscribe":
                        # Client subscribing to specific events
                        await websocket.send_json({
                            "type": "subscribed",
                            "data": {"channels": message.get("channels", [])},
                            "timestamp": datetime.now().isoformat()
                        })
                    elif msg_type == "ping":
                        await websocket.send_text("pong")

                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from WebSocket client: {data}")

            except asyncio.TimeoutError:
                # Send keepalive
                try:
                    await websocket.send_json({
                        "type": "keepalive",
                        "timestamp": datetime.now().isoformat()
                    })
                except Exception:
                    break

    except WebSocketDisconnect:
        logger.info("[WS] Client disconnected normally")
    except Exception as e:
        logger.error(f"[WS] WebSocket error: {e}")
    finally:
        await manager.disconnect(websocket)


# =============================================================================
# Health Check
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "CCN Fault Perception API",
        "version": "1.0.0",
        "endpoints": {
            "dashboard": "/api/dashboard/summary",
            "iterations": "/api/iterations",
            "cases": "/api/cases",
            "perception": "/api/perception/current",
            "evaluator": "/api/evaluator/suggestions",
            "websocket": "/ws"
        }
    }


# =============================================================================
# Startup Event
# =============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize managers on startup."""
    global iteration_manager, case_library_manager, perception_agent

    logger.info("Starting CCN Fault Perception API Server...")

    # Initialize managers
    iteration_manager = IterationStateManager("iteration_state/states.json")
    case_library_manager = CaseLibraryManager("case_library/cases.json")

    # Get historical cases for perception agent
    historical_cases = [c.to_dict() for c in case_library_manager.get_all_cases()]
    perception_agent = FaultPerceptionAgent(
        config={
            "historical_cases": historical_cases,
            "confidence_threshold_high": 0.85,
            "confidence_threshold_medium": 0.5,
            "enable_self_optimization": True
        }
    )

    logger.info("API Server initialized successfully")


# =============================================================================
# Run with uvicorn
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "runner.api_server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
