-- Runs once when the container's data directory is first created.
-- btree_gist backs the appointment overlap EXCLUDE constraint; the migration
-- creates the extension itself, this just makes sure the test database exists.
CREATE DATABASE niramoy_test OWNER niramoy;
