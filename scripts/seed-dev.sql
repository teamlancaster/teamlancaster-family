-- LOCAL DEV ONLY. Clearly fake placeholder people. Never run against production.
DELETE FROM person; DELETE FROM unions; DELETE FROM parent_child; DELETE FROM branch; DELETE FROM person_branch;
DELETE FROM photo_tag; DELETE FROM change_request; DELETE FROM audit_log; DELETE FROM photo; DELETE FROM form_hit;
DELETE FROM sqlite_sequence WHERE name IN ('change_request','audit_log');
INSERT INTO person (id,first_name,last_name,birth_year,adult_confirmed,public_ok,is_founder,bio_md) VALUES
 ('p_fa','Example','Founder-A',1950,1,1,1,'Example Founder A is a placeholder person used only for local testing.'),
 ('p_fb','Sample','Founder-B',1952,1,1,1,NULL),
 ('p_c1','Test','Person-One',1975,1,1,0,'Placeholder bio. Grew up somewhere near the coast (fake).'),
 ('p_c2','Demo','Person-Two',1978,1,1,0,NULL),
 ('p_c3','Mock','Person-Three',1981,1,0,0,NULL),
 ('p_p1','Fake','Partner-One',1976,1,0,0,NULL),
 ('p_k1','Placeholder','Kid-One',2015,0,0,0,NULL),
 ('p_k2','Dummy','NoYear',NULL,0,0,0,NULL),
 ('p_p2','Sample','Partner-Two',1979,1,0,0,NULL);
INSERT INTO unions (id,partner_a,partner_b,kind,start_year) VALUES
 ('u_f','p_fa','p_fb','married',1972),('u_1','p_c1','p_p1','married',2001),('u_2','p_c2','p_p2','partner',2005);
INSERT INTO parent_child (parent_id,child_id,kind,union_id) VALUES
 ('p_fa','p_c1','bio','u_f'),('p_fb','p_c1','bio','u_f'),('p_fa','p_c2','bio','u_f'),('p_fb','p_c2','bio','u_f'),
 ('p_fa','p_c3','adopted','u_f'),('p_c1','p_k1','bio','u_1'),('p_p1','p_k1','bio','u_1'),('p_c2','p_k2','step',NULL);
INSERT INTO branch (id,slug,display_name,root_union_id,sort,pw_version) VALUES
 ('b_1','example-one','Example Branch One','u_1',1,0),('b_2','example-two','Example Branch Two','u_2',2,0);
INSERT INTO person_branch VALUES ('p_c1','b_1'),('p_p1','b_1'),('p_k1','b_1'),('p_c2','b_2'),('p_p2','b_2'),('p_k2','b_2');
INSERT INTO change_request (source,branch_id,requester_name,person_text,change_text,kind,created_at) VALUES
 ('public',NULL,'Example Visitor','Test Person-One','Please correct the birth year to 1974 (example request).','edit',strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours')),
 ('branch','b_1','Example Member','Fake Partner-One','Please add our example wedding year 2002 instead of 2001.','edit',strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')),
 ('branch','b_2','Example Member Two','Demo Person-Two','Can you take down the example beach photo? (placeholder)','photo_removal',strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'));
INSERT INTO audit_log (actor_email,action,entity,entity_id,summary,before_json,after_json,undoable,at) VALUES
 ('dev@localhost','update','person','p_c2','Edited Demo Person-Two (bio, seed example)',NULL,NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 minutes'));
