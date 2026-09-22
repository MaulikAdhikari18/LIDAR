from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.v1.endpoints import router as api_v1_router
from api.live_endpoints import router as live_router
import uvicorn

app = FastAPI(
    title="FoveaMap — Adaptive Variable Resolution 2.5D LiDAR Mapping",
    description="Utility-driven, predictive, hierarchical 2.5D LiDAR mapping backend "
                "with a finite computational budget, dynamic resource reclamation, "
                "confidence-aware adaptation and prediction-error recovery.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix="/api/v1")   # original documented FoveaMap contract
app.include_router(live_router, prefix="/api")         # frontend-compatible contract (correct/expected)
app.include_router(live_router, prefix="")             # SAFETY NET: also answer on bare paths
                                                         # (e.g. /frame, /config) with no /api prefix
                                                         # at all, in case a stale/misconfigured
                                                         # frontend build calls it that way. Both
                                                         # mounts point at the exact same live
                                                         # session/logic -- this only removes a
                                                         # class of path-prefix mistakes, it does
                                                         # not change behavior for correctly-formed
                                                         # /api/... requests.


@app.get("/")
async def root():
    return {"message": "FoveaMap Adaptive Mapping Backend Running"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
