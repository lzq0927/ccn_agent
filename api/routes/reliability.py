"""ReMAP's AI-system reliability module API."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.routing import APIRoute

from reliability import catalog
from reliability.models import Design, DesignUpdate, RevisionRequest, SessionRequest
from reliability.opencode import OpenCodeAdapter, OpenCodeUnavailable
from reliability.service import ReliabilityService
from reliability.solver import validate_design
from reliability.store import ConflictError


class DomainRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                return await original(request)
            except KeyError as error:
                raise HTTPException(404, str(error)) from error
            except ConflictError as error:
                raise HTTPException(409, str(error)) from error
            except OpenCodeUnavailable as error:
                raise HTTPException(503, str(error)) from error
            except ValueError as error:
                raise HTTPException(422, str(error)) from error

        return handler


def get_service():
    return ReliabilityService()


def get_agent():
    return OpenCodeAdapter()


Service = Annotated[ReliabilityService, Depends(get_service)]
Agent = Annotated[OpenCodeAdapter, Depends(get_agent)]
router = APIRouter(route_class=DomainRoute)


@router.get("/capabilities")
def capabilities():
    return catalog.capabilities()


@router.get("/knowledge")
def knowledge(query: str = ""):
    return catalog.knowledge(query)


@router.get("/scenarios")
def scenarios():
    return {"scenarios": catalog.scenarios(), "topology": catalog.topology()}


@router.get("/designs")
def designs(service: Service):
    return service.store.list_designs()


@router.post("/designs", status_code=201)
def create_design(design: Design, service: Service):
    return service.create_design(design)


@router.post("/designs/validate")
def check_design(design: Design):
    return {"valid": True, "warnings": validate_design(design)}


@router.get("/designs/{design_id}")
def get_design(design_id: str, service: Service):
    return service.store.get_design(design_id)


@router.put("/designs/{design_id}")
def update_design(design_id: str, body: DesignUpdate,
                  service: Service):
    return service.update_design(design_id, body.design, body.expected_revision)


@router.post("/designs/{design_id}/runs", status_code=201)
def run_design(design_id: str, body: RevisionRequest,
               service: Service):
    return service.run(design_id, body.expected_revision)


@router.get("/designs/{design_id}/runs")
def list_runs(design_id: str, service: Service):
    return service.store.list_runs(design_id)


@router.get("/runs/{run_id}")
def get_run(run_id: str, service: Service):
    return service.store.get_run(run_id)


@router.post("/runs/{run_id}/replay", status_code=201)
def replay(run_id: str, service: Service):
    return service.replay(run_id)


@router.get("/runs/{run_id}/report", response_class=PlainTextResponse)
def report(run_id: str, service: Service):
    return PlainTextResponse(service.report(run_id), media_type="text/markdown",
                             headers={"Content-Disposition": 'attachment; filename="reliability.md"'})


@router.get("/agent/health")
async def agent_health(agent: Agent):
    return await agent.health()


@router.post("/agent/sessions", status_code=201)
async def create_session(body: SessionRequest, service: Service,
                         agent: Agent):
    design = service.current(body.design_id, body.expected_revision)
    session = await agent.create_session(design)
    return {**service.store.bind_session(session["id"], design), "url": session["url"]}


@router.post("/agent/sessions/{session_id}/workflow")
async def run_workflow(session_id: str, service: Service,
                       agent: Agent):
    binding = service.store.get_session(session_id)
    service.current(binding["design_id"], binding["revision"])
    return await agent.run_workflow(session_id, binding["design_id"])
