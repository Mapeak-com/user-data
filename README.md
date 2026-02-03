# user-data
A microservice to manage the user data

### To build locally:

docker build . -t mapeak/user-data

### To run locally:

docker run --rm -it -p 3000:3000 -e ES_URL=http://host.docker.internal:9200  mapeak/user-data
