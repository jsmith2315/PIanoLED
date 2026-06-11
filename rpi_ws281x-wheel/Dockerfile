FROM --platform=$TARGETPLATFORM python:3.11-bookworm AS build

RUN apt-get update && apt-get install -y \
    build-essential \
    scons \
    swig \
 && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip wheel
RUN python -m pip wheel --no-deps rpi-ws281x==5.0.0 -w /wheelhouse

FROM scratch
COPY --from=build /wheelhouse /wheelhouse
